import "@/lib/server-only-shim";
import { z } from "zod";
import { one, q } from "../db";
import { HttpError } from "../errors";
import { StrategySchema, createAgent } from "./service";
import { backtestStrategy, type Bars } from "./signals";
import { defaultStrategy, type StrategyKind } from "./catalog";

/**
 * Strategy Builder: natural language → typed strategy parameters → backtest on REAL history (fees + slippage)
 * → stress scenarios → immutable versions → deploy as a paper agent. Scenarios transform the real price path
 * (volatility ×1.5 / ×0.5, −30% bear drift) and are labelled as stress tests, not forecasts.
 */
export const BuilderConfig = z.object({
  asset: z.string().min(1).max(24),
  timeframe: z.enum(["15m", "1h", "1d"]).default("1h"),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  strategy: StrategySchema.partial().extend({ kind: StrategySchema.shape.kind }),
  enabled: z.object({ entry: z.boolean().default(true), exit: z.boolean().default(true), risk: z.boolean().default(true) }).default({ entry: true, exit: true, risk: true }),
  positionPct: z.number().min(0.1).max(100).default(2),
  maxDrawdownPct: z.number().min(1).max(100).default(15),
});
export type BuilderConfigT = z.infer<typeof BuilderConfig>;

/** Deterministic text → parameters (no AI call; every number comes from the user's words or defaults). */
export async function draftFromText(text: string) {
  const t = text.toLowerCase();
  const kind: StrategyKind = /mean.?reversion|oversold|rsi\s*(<|below|under)/.test(t) ? "mean_reversion" : /breakout|break out/.test(t) ? "breakout" : /\bdip|pullback/.test(t) ? "dip"
    : /dca|accumulat|recurring/.test(t) ? "dca" : /news/.test(t) ? "news" : "momentum";
  const num = (re: RegExp) => { const m = t.match(re); return m ? Number(m[1]) : undefined; };
  const s: any = { ...defaultStrategy(kind) };
  const tp = num(/(?:take.?profit|tp|profit (?:at|of|target))\D{0,8}(\d+(?:\.\d+)?)\s*%/) ?? num(/(\d+(?:\.\d+)?)\s*%\s*(?:profit|gain|take)/);
  const sl = num(/(?:stop.?loss|stop|sl)\D{0,8}(\d+(?:\.\d+)?)\s*%/) ?? num(/(\d+(?:\.\d+)?)\s*%\s*stop/);
  const dip = num(/(\d+(?:\.\d+)?)\s*%\s*(?:dip|drop|pullback)/);
  const rsi = num(/rsi\D{0,10}(\d{1,2})/);
  if (tp != null) s.takeProfitPct = tp; if (sl != null) s.stopLossPct = sl; if (dip != null && kind === "dip") s.dipPct = dip;
  if (rsi != null && kind === "mean_reversion") s.rsiBuy = rsi;
  if (/risk control|tight risk|conservative/.test(t)) s.stopLossPct = Math.min(s.stopLossPct || 1.5, 1.5);
  if (/dynamic exit|trailing/.test(t)) s.takeProfitPct = Math.max(s.takeProfitPct, 6);
  const sym = (text.match(/\b([A-Z]{2,6})(?:\/USDT?|\b)/) ?? [])[1] ?? (/bitcoin|btc/.test(t) ? "BTC" : /ethereum|eth\b/.test(t) ? "ETH" : /nvidia|nvda/.test(t) ? "NVDA" : /solana|sol\b/.test(t) ? "SOL" : "SOL");
  const timeframe = /\b(daily|1d|swing)\b/.test(t) ? "1d" : /\b15 ?m(in)?\b|scalp/.test(t) ? "15m" : "1h";
  return BuilderConfig.parse({ asset: sym, timeframe, strategy: s });
}

async function loadBars(asset: string, tf: string, from?: string, to?: string) {
  const a = await one<any>("SELECT id, symbol, asset_class FROM assets WHERE (upper(symbol)=upper($1) OR id::text=$1) AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 1", [asset]);
  if (!a) throw new HttpError(404, `No asset "${asset}"`);
  const table = tf === "15m" ? "5m" : tf;
  const rows = await q<any>(
    `SELECT extract(epoch from ts)*1000 AS t, close, volume, high, low, source FROM price_bars WHERE asset_id=$1 AND timeframe=$2
       AND ($3::date IS NULL OR ts >= $3::date) AND ($4::date IS NULL OR ts < $4::date + 1) ORDER BY ts ASC LIMIT 20000`, [a.id, table, from || null, to || null]);
  let r = rows;
  if (tf === "15m") { r = []; for (let i = 0; i + 2 < rows.length; i += 3) r.push({ t: rows[i].t, close: rows[i + 2].close, volume: Number(rows[i].volume) + Number(rows[i + 1].volume) + Number(rows[i + 2].volume), high: Math.max(rows[i].high, rows[i + 1].high, rows[i + 2].high), low: Math.min(rows[i].low, rows[i + 1].low, rows[i + 2].low) }); }
  const bars: Bars & { ts: number[] } = { ts: r.map((x) => Number(x.t)), close: r.map((x) => Number(x.close)), volume: r.map((x) => Number(x.volume)), high: r.map((x) => Number(x.high)), low: r.map((x) => Number(x.low)) };
  return { asset: a, bars, simulated: rows.some((x) => x.source === "simulated") };
}
function scenario(b: Bars & { ts: number[] }, kind: "high_vol" | "low_vol" | "bear"): Bars & { ts: number[] } {
  const n = b.close.length; if (!n) return b;
  const base = b.close[0];
  const close = b.close.map((c, i) => {
    if (kind === "bear") return c * (1 - 0.3 * (i / Math.max(1, n - 1)));
    const k = kind === "high_vol" ? 1.5 : 0.5;
    const trend = base + ((b.close[n - 1] - base) * i) / Math.max(1, n - 1);
    return Math.max(trend * 0.05, trend + (c - trend) * k);
  });
  const ratio = close.map((c, i) => c / (b.close[i] || 1));
  return { ts: b.ts, close, volume: b.volume, high: b.high.map((h, i) => h * ratio[i]), low: b.low.map((l, i) => l * ratio[i]) };
}

export async function runBacktest(cfg: BuilderConfigT, withScenarios = true) {
  const { asset, bars, simulated } = await loadBars(cfg.asset, cfg.timeframe, cfg.from, cfg.to);
  if (bars.close.length < 60) throw new HttpError(422, `Only ${bars.close.length} ${cfg.timeframe} bars of ${asset.symbol} in range. Pick a longer range or another timeframe.`);
  const s: any = { ...cfg.strategy };
  if (!cfg.enabled.exit) { s.takeProfitPct = 0; s.stopLossPct = 0; }
  if (!cfg.enabled.entry) s.kind = "none";
  const barMs = cfg.timeframe === "1d" ? 86_400_000 : cfg.timeframe === "15m" ? 900_000 : 3_600_000;
  s.tradeUsd = (10_000 * cfg.positionPct) / 100 / 10; // backtester sizes 10× tradeUsd of a $10k account
  const main = backtestStrategy(s, bars, { barMs });
  const years = (bars.ts[bars.ts.length - 1] - bars.ts[0]) / (365 * 86_400_000);
  const cagr = years > 0.05 ? (Math.pow(main.endValue / main.startValue, 1 / years) - 1) * 100 : null;
  const out: any = { ...main, cagr, asset: asset.symbol, timeframe: cfg.timeframe, from: new Date(bars.ts[0]).toISOString().slice(0, 10), to: new Date(bars.ts[bars.ts.length - 1]).toISOString().slice(0, 10),
    years, simulatedData: simulated, label: "Backtested on real history with fees and slippage. Past results don't guarantee future results.", ddBreached: main.maxDrawdownPct > cfg.maxDrawdownPct };
  if (withScenarios) out.scenarios = (["high_vol", "low_vol", "bear"] as const).map((k) => ({ key: k, label: k === "high_vol" ? "Higher Volatility (+50%)" : k === "low_vol" ? "Lower Volatility (−50%)" : "Bear Market (−30%)", returnPct: backtestStrategy(s, scenario(bars, k), { barMs }).returnPct }));
  return out;
}

export async function listBuilder(userId: string) {
  return q<any>(`SELECT s.id, s.name, s.updated_at, (SELECT json_agg(v ORDER BY v.version DESC) FROM (SELECT version, config, note, created_at, backtest->'returnPct' AS ret, backtest->'winRate' AS win FROM builder_strategy_versions WHERE strategy_id=s.id ORDER BY version DESC LIMIT 20) v) AS versions
                   FROM builder_strategies s WHERE s.user_id=$1 ORDER BY s.updated_at DESC`, [userId]);
}
export async function saveVersion(userId: string, name: string, cfg: BuilderConfigT, backtest: any, note?: string) {
  const s = await one<any>("INSERT INTO builder_strategies (user_id, name) VALUES ($1,$2) ON CONFLICT (user_id, name) DO UPDATE SET updated_at=now() RETURNING id", [userId, name.slice(0, 80)]);
  const v = await one<any>("INSERT INTO builder_strategy_versions (strategy_id, version, config, backtest, note) SELECT $1, COALESCE(MAX(version),0)+1, $2, $3, $4 FROM builder_strategy_versions WHERE strategy_id=$1 RETURNING version",
    [s.id, JSON.stringify(cfg), backtest ? JSON.stringify({ ...backtest, equity: undefined, tradeLog: undefined }) : null, note ?? null]);
  return { id: s.id, version: v.version };
}
export async function deploy(userId: string, name: string, cfg: BuilderConfigT, capitalUsd: number, isOwner: boolean) {
  const crypto = !!(await one("SELECT 1 FROM assets WHERE upper(symbol)=upper($1) AND asset_class='crypto' LIMIT 1", [cfg.asset]));
  return createAgent(userId, { name: name.slice(0, 60), role: crypto ? "crypto_trading" : "stock_trading", assets: [cfg.asset], strategy: { ...cfg.strategy, timeframe: cfg.timeframe, tradeUsd: Math.max(1, (capitalUsd * cfg.positionPct) / 100) } as any,
    autonomy: 5, capitalUsd, risk: { dailyLossUsd: Math.max(1, (capitalUsd * cfg.maxDrawdownPct) / 100) }, instructions: `Deployed from Strategy Builder: ${name}` }, { lineage: "templated", status: "configured", isOwner });
}
