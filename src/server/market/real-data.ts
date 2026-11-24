import "@/lib/server-only-shim";
import { one, q } from "../db";
import { getFlags } from "../flags";
import { getConfig, providerUsable, contextFor } from "../providers/integrations";
import { readJson } from "../providers/http";

/**
 * REAL MARKET DATA ONLY
 * With the "simulated_prices" flag off (the production default) Merod never makes up a price:
 *  • the simulated feed doesn't run, and any simulated prices/history left over are deleted;
 *  • crypto prices come from CoinGecko and DEX Screener (their keyless public tiers work out of the box);
 *  • stock prices come from Alpaca once it's connected; until then stocks show no price instead of a fake one;
 *  • charts are filled with real history from those providers, then extended with every real price tick.
 */

export async function simulationOn() { return (await getFlags()).simulated_prices === true; }

/** Keyless public providers are on by default; an admin can still switch them off in the Integration Center. */
export async function keylessUsable(providerId: "coingecko" | "dexscreener") {
  if (await providerUsable(providerId, "production")) return true;
  const cfg = await getConfig(providerId, "production");
  return cfg.status === "not_configured" || (cfg.enabled && !["disabled", "connection_error", "restricted"].includes(cfg.status));
}

/** Remove every made-up number: simulated prices, simulated chart history and demo tokens. */
export async function purgeSimulatedData() {
  const bars = await q<{ n: number }>("WITH d AS (DELETE FROM price_bars WHERE source='simulated' RETURNING 1) SELECT count(*)::int AS n FROM d");
  const assets = await q<{ id: string }>(
    `UPDATE assets SET last_price=NULL, change_24h=NULL, volume_24h=NULL, market_cap=NULL, liquidity_usd=NULL, price_source=NULL, price_updated_at=NULL
      WHERE price_source='simulated' RETURNING id`);
  await q("UPDATE assets SET tradability='unsupported' WHERE 'demo_data' = ANY(risk_flags) AND tradability <> 'unsupported'");
  return { barsDeleted: bars[0]?.n ?? 0, pricesCleared: assets.length };
}

const TF_SEC: Record<string, number> = { "5m": 300, "1h": 3600, "1d": 86400 };

/** Extend chart candles with a real price tick (source = the provider it came from). */
export async function recordTick(assetId: string, price: number, source: string, atMs = Date.now()) {
  for (const tf of ["5m", "1h", "1d"]) {
    const ts = Math.floor(atMs / 1000 / TF_SEC[tf]) * TF_SEC[tf];
    await q(`INSERT INTO price_bars (asset_id, timeframe, ts, open, high, low, close, volume, source)
             VALUES ($1,$2,to_timestamp($3),$4,$4,$4,$4,0,$5)
             ON CONFLICT (asset_id, timeframe, ts) DO UPDATE SET high=GREATEST(price_bars.high,$4), low=LEAST(price_bars.low,$4), close=$4, source=$5`,
      [assetId, tf, ts, price, source]);
  }
}

/** Build OHLC candles from a series of real price samples. */
export function toCandles(points: [number, number][], tfSec: number) {
  const m = new Map<number, { o: number; h: number; l: number; c: number }>();
  for (const [ms, p] of points.sort((a, b) => a[0] - b[0])) {
    const t = Math.floor(ms / 1000 / tfSec) * tfSec;
    const b = m.get(t);
    if (!b) m.set(t, { o: p, h: p, l: p, c: p }); else { b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); b.c = p; }
  }
  return [...m.entries()].map(([t, b]) => ({ t, ...b }));
}

async function saveCandles(assetId: string, tf: string, candles: { t: number; o: number; h: number; l: number; c: number }[], source: string) {
  for (let i = 0; i < candles.length; i += 500) {
    const chunk = candles.slice(i, i + 500);
    const vals: unknown[] = [];
    const tuples = chunk.map((c, j) => { vals.push(assetId, tf, c.t, c.o, c.h, c.l, c.c, source); const b = j * 8; return `($${b + 1},$${b + 2},to_timestamp($${b + 3}),$${b + 4},$${b + 5},$${b + 6},$${b + 7},0,$${b + 8})`; });
    await q(`INSERT INTO price_bars (asset_id,timeframe,ts,open,high,low,close,volume,source) VALUES ${tuples.join(",")}
             ON CONFLICT (asset_id, timeframe, ts) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close, source=EXCLUDED.source`, vals);
  }
}

/**
 * Fill charts with real history, a few assets per run (public API rate limits).
 * Crypto: CoinGecko price samples (5-min for the last day, hourly for 90 days, daily for a year).
 * Stocks: Alpaca bars when Alpaca is connected.
 */
export async function backfillRealHistory(perRun = 3) {
  let done = 0;
  const due = await q<any>(
    `SELECT a.id, a.symbol, a.asset_class, a.coingecko_id, a.venue,
            (SELECT max(ts) FROM price_bars b WHERE b.asset_id=a.id AND b.timeframe='1d' AND b.source <> 'simulated') AS last_real
       FROM assets a
      WHERE NOT ('demo_data' = ANY(a.risk_flags)) AND a.tradability <> 'unsupported'
        AND (a.coingecko_id IS NOT NULL OR a.asset_class IN ('stock','etf'))
        AND (a.history_backfilled_at IS NULL OR a.history_backfilled_at < now() - interval '12 hours')
      ORDER BY (SELECT count(*) FROM price_bars b WHERE b.asset_id=a.id AND b.source <> 'simulated') ASC, a.market_cap DESC NULLS LAST
      LIMIT $1`, [perRun]);
  for (const a of due) {
    try {
      if (a.coingecko_id && (await keylessUsable("coingecko"))) {
        const ctx = contextFor("coingecko", "production");
        const key = await ctx.cred("COINGECKO_API_KEY");
        const plan = (await ctx.setting("plan")) ?? "demo";
        const base = key && plan === "pro" ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
        const headers: Record<string, string> = key ? { [plan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {};
        const get = async (days: number) => ((await readJson(await ctx.fetch(`${base}/coins/${encodeURIComponent(a.coingecko_id)}/market_chart?vs_currency=usd&days=${days}`, { headers, timeoutMs: 15_000 }), "coingecko"))?.prices ?? []) as [number, number][];
        await saveCandles(a.id, "5m", toCandles(await get(1), 300), "coingecko");
        await saveCandles(a.id, "1h", toCandles(await get(90), 3600), "coingecko");
        await saveCandles(a.id, "1d", toCandles(await get(365), 86400), "coingecko");
      } else if (a.asset_class !== "crypto") {
        const penv = (await providerUsable("alpaca_trading", "production")) ? "production" : (await providerUsable("alpaca_trading", "sandbox")) ? "sandbox" : null;
        if (!penv) continue;
        const ctx = contextFor("alpaca_trading", penv);
        const headers = { "APCA-API-KEY-ID": (await ctx.cred("ALPACA_API_KEY"))!, "APCA-API-SECRET-KEY": (await ctx.cred("ALPACA_API_SECRET"))! };
        const feed = (await ctx.setting("data_feed")) ?? "iex";
        const now = Date.now();
        for (const [tf, alp, back] of [["5m", "5Min", 2], ["1h", "1Hour", 90], ["1d", "1Day", 365 * 3]] as const) {
          const start = new Date(now - back * 86_400_000).toISOString();
          const j = await readJson(await ctx.fetch(`https://data.alpaca.markets/v2/stocks/${a.symbol}/bars?timeframe=${alp}&start=${start}&limit=10000&adjustment=split&feed=${feed}`, { headers, timeoutMs: 15_000 }), "alpaca_trading");
          await saveCandles(a.id, tf, (j?.bars ?? []).map((b: any) => ({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c })), `alpaca:${feed}`);
        }
      } else continue;
      await q("UPDATE assets SET history_backfilled_at=now() WHERE id=$1", [a.id]);
      done++;
    } catch { /* rate limited or unreachable: retried on the next run */ }
  }
  return done;
}

/** One-time startup step for the worker. */
export async function ensureRealData() {
  if (await simulationOn()) return null;
  return purgeSimulatedData();
}

export async function realDataStatus() {
  const r = await one<any>(`SELECT count(*) FILTER (WHERE price_source IS NOT NULL AND price_source <> 'simulated')::int AS real,
                                   count(*) FILTER (WHERE price_source IS NULL)::int AS no_price,
                                   count(*) FILTER (WHERE price_source = 'simulated')::int AS simulated FROM assets WHERE NOT ('demo_data' = ANY(risk_flags))`);
  return r;
}
