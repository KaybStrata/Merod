import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { HttpError } from "@/server/errors";

/**
 * Portfolio value over any window (presets like 1m…1Y, or ?seconds= for a custom length).
 * Recorded portfolio_snapshots are used only when they cover the whole window (they reflect true past holdings);
 * otherwise the series is estimated from price bars × CURRENT holdings + cash (and labelled as estimated).
 * The last point is always the live value from current prices.
 */
const PRESETS: Record<string, number> = {
  "1m": 60, "15m": 900, "30m": 1800, "1h": 3600, "6h": 21_600, "12h": 43_200,
  "1D": 86_400, "1W": 604_800, "1M": 2_592_000, "3M": 7_776_000, "1Y": 31_536_000, ALL: 315_360_000,
};

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const range = sp.get("range") ?? "1M";
  const secs = sp.get("seconds") ? Math.floor(Number(sp.get("seconds"))) : PRESETS[range] ?? PRESETS["1M"];
  if (!(secs >= 60 && secs <= 315_360_000)) throw new HttpError(400, "Pick a window between 1 minute and 10 years");
  const now = Math.floor(Date.now() / 1000), start = now - secs;

  // Live value right now.
  const cash = Number((await q<any>("SELECT COALESCE(SUM(cash_balance),0) AS c FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u.id]))[0].c);
  const holdings = await q<any>(
    `SELECT p.asset_id, SUM(p.quantity) AS quantity, MAX(a.last_price) AS px FROM positions p JOIN trading_accounts t ON t.id=p.account_id JOIN assets a ON a.id=p.asset_id
      WHERE p.user_id=$1 AND t.kind='paper' AND p.quantity>0 GROUP BY p.asset_id`, [u.id]);
  const liveValue = cash + holdings.reduce((s, h) => s + Number(h.quantity) * Number(h.px ?? 0), 0);

  // 1) Recorded snapshots, if they reach back to the start of the window.
  const snaps = await q<any>(
    `SELECT extract(epoch from ts)::bigint AS time, total_value AS value FROM portfolio_snapshots
      WHERE user_id=$1 AND is_paper AND ts >= to_timestamp($2) ORDER BY ts`, [u.id, start]);
  const before = await q<any>("SELECT total_value AS value FROM portfolio_snapshots WHERE user_id=$1 AND is_paper AND ts < to_timestamp($2) ORDER BY ts DESC LIMIT 1", [u.id, start]);
  const resolution = secs <= 2 * 86_400 ? 300 : secs <= 60 * 86_400 ? 3600 : 86_400;
  if (before.length && snaps.length >= 2) {
    const points = [{ time: start, value: Number(before[0].value) }, ...snaps.map((s) => ({ time: Number(s.time), value: Number(s.value) })), { time: now, value: liveValue }];
    return ok({ range, seconds: secs, points: dedupe(points), estimated: false, resolutionSec: 300 });
  }

  // 2) Estimate from price bars × current holdings (+ cash).
  const tf = resolution === 300 ? "5m" : resolution === 3600 ? "1h" : "1d";
  const series = new Map<number, number>();
  for (const h of holdings) {
    const bars = await q<any>(
      `SELECT extract(epoch from ts)::bigint AS time, close FROM price_bars WHERE asset_id=$1 AND timeframe=$2 AND ts >= to_timestamp($3) - make_interval(secs => $4) ORDER BY ts`,
      [h.asset_id, tf, start, resolution]);
    let last: number | null = null;
    for (const b of bars) {
      const t = Math.max(Number(b.time), start);
      last = Number(b.close);
      series.set(t, (series.get(t) ?? 0) + last * Number(h.quantity));
    }
  }
  let points = [...series.entries()].sort((a, b) => a[0] - b[0]).map(([time, v]) => ({ time, value: v + cash }));
  if (!points.length || points[0].time > start) points.unshift({ time: start, value: points[0]?.value ?? liveValue });
  points.push({ time: now, value: liveValue });
  return ok({ range, seconds: secs, points: dedupe(points), estimated: holdings.length > 0, resolutionSec: resolution,
    note: holdings.length ? "Estimated from current holdings × historical prices; not a record of past balances." : undefined });
});

function dedupe(points: { time: number; value: number }[]) {
  const seen = new Map<number, number>();
  for (const p of points) seen.set(p.time, p.value);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
}
