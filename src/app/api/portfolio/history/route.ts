import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/**
 * Portfolio value series. Uses recorded portfolio_snapshots when there are enough points;
 * otherwise estimates history from daily bars × CURRENT holdings + current cash (marked estimated).
 */
export const GET = route(async (req) => {
  const u = await requireUser();
  const range = new URL(req.url).searchParams.get("range") ?? "1M";
  const days = ({ "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365, ALL: 3650 } as Record<string, number>)[range] ?? 30;
  const snaps = await q<any>(
    `SELECT extract(epoch from ts)::bigint AS time, total_value AS value FROM portfolio_snapshots
      WHERE user_id=$1 AND is_paper AND ts > now() - make_interval(days => $2) ORDER BY ts`, [u.id, days]);
  if (snaps.length >= 12) return ok({ range, points: snaps, estimated: false });

  const tf = days <= 2 ? "1h" : "1d";
  const holdings = await q<any>(
    `SELECT p.asset_id, p.quantity FROM positions p JOIN trading_accounts t ON t.id=p.account_id WHERE p.user_id=$1 AND t.kind='paper' AND p.quantity>0`, [u.id]);
  const cash = Number((await q<any>("SELECT COALESCE(SUM(cash_balance),0) AS c FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u.id]))[0].c);
  const series = new Map<number, number>();
  for (const h of holdings) {
    const bars = await q<any>(
      `SELECT extract(epoch from ts)::bigint AS time, close FROM price_bars WHERE asset_id=$1 AND timeframe=$2 AND ts > now() - make_interval(days => $3) ORDER BY ts`,
      [h.asset_id, tf, days]);
    for (const b of bars) series.set(Number(b.time), (series.get(Number(b.time)) ?? 0) + Number(b.close) * Number(h.quantity));
  }
  let points = [...series.entries()].sort((a, b) => a[0] - b[0]).map(([time, v]) => ({ time, value: v + cash }));
  if (!points.length) points = [{ time: Math.floor(Date.now() / 1000) - days * 86400, value: cash }, { time: Math.floor(Date.now() / 1000), value: cash }];
  return ok({ range, points, estimated: true, note: "Estimated from current holdings × historical prices; not a record of past balances." });
});
