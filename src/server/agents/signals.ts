/**
 * Deterministic indicators and strategy rules for agents. Pure functions: the same recorded inputs always
 * produce the same decision, which powers Agent Replay, the Black Box and the backtests in Auto-Training.
 * AI never decides an order here; it only writes summaries elsewhere.
 */
export interface Bars { close: number[]; volume: number[]; high: number[]; low: number[] }
export interface Indicators {
  price: number; rsi14: number | null; ema12: number | null; ema26: number | null; macd: number | null; sma20: number | null;
  change1hPct: number | null; change24hPct: number | null; volumeRise: number | null; high20: number | null; low20: number | null; bars: number;
}

export function ema(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  const k = 2 / (n + 1);
  let e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < xs.length; i++) e = xs[i] * k + e * (1 - k);
  return e;
}
export function rsi(xs: number[], n = 14): number | null {
  if (xs.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = xs.length - n; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; if (d >= 0) g += d; else l -= d; }
  if (l === 0) return 100;
  const rs = g / n / (l / n);
  return 100 - 100 / (1 + rs);
}
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);

export function indicators(b: Bars, livePrice?: number): Indicators {
  const c = livePrice ? [...b.close, livePrice] : b.close;
  const price = c.at(-1) ?? 0;
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const last20 = c.slice(-21, -1);
  const v = b.volume.filter((x) => x > 0);
  const vNow = v.slice(-3).reduce((a, x) => a + x, 0) / Math.max(1, Math.min(3, v.length));
  const vPrev = v.slice(-23, -3).reduce((a, x) => a + x, 0) / Math.max(1, Math.min(20, Math.max(0, v.length - 3)));
  return {
    price, rsi14: rsi(c), ema12: e12, ema26: e26, macd: e12 != null && e26 != null ? e12 - e26 : null,
    sma20: c.length >= 20 ? c.slice(-20).reduce((a, x) => a + x, 0) / 20 : null,
    change1hPct: c.length >= 2 ? pct(price, c.at(-2)!) : null, change24hPct: c.length >= 25 ? pct(price, c.at(-25)!) : null,
    volumeRise: v.length >= 6 && vPrev > 0 ? vNow / vPrev : null,
    high20: last20.length ? Math.max(...last20) : null, low20: last20.length ? Math.min(...last20) : null, bars: c.length,
  };
}

export type Signal = { action: "buy" | "sell" | "hold"; confidence: number; reason: string; checks: string[] };
const f = (x: number | null | undefined, d = 1) => (x == null ? "n/a" : x.toFixed(d));

/** Strategy rule → signal. `holding` = agent already has a position in the asset; `ctx.ref` = reference price for dips. */
export function decide(strategy: any, ind: Indicators, ctx: { holding: boolean; ref?: number | null; lastBuyAt?: number | null; now?: number } = { holding: false }): Signal {
  const s = strategy ?? {}, checks: string[] = [];
  const kind = s.kind ?? "momentum";
  if (ind.bars < 15) return { action: "hold", confidence: 0, reason: `Waiting for history (${ind.bars} bars)`, checks };
  checks.push(`RSI ${f(ind.rsi14, 0)}`, `MACD ${ind.macd == null ? "n/a" : ind.macd >= 0 ? "positive" : "negative"}`, `24h ${f(ind.change24hPct, 2)}%`);
  if (ind.volumeRise != null) checks.push(`Volume ×${f(ind.volumeRise, 2)}`);
  if (kind === "momentum" || kind === "news") {
    const min = Number(s.minChangePct ?? 1.5), rsiMax = Number(s.rsiMax ?? 75);
    const up = (ind.change24hPct ?? 0) >= min && (ind.macd ?? 0) > 0 && (ind.rsi14 ?? 50) < rsiMax;
    if (!ctx.holding && up) return { action: "buy", confidence: Math.min(0.95, 0.55 + (ind.change24hPct ?? 0) / 40 + ((ind.volumeRise ?? 1) - 1) / 4), reason: `Momentum: 24h ${f(ind.change24hPct, 2)}% ≥ ${min}%, MACD positive, RSI ${f(ind.rsi14, 0)} < ${rsiMax}`, checks };
    if (ctx.holding && (ind.macd ?? 0) < 0 && (ind.rsi14 ?? 50) < 45) return { action: "sell", confidence: 0.6, reason: `Momentum fading: MACD negative, RSI ${f(ind.rsi14, 0)}`, checks };
    return { action: "hold", confidence: 0.3, reason: ctx.holding ? "Momentum intact; holding" : `No entry: needs 24h ≥ ${min}% with MACD positive`, checks };
  }
  if (kind === "mean_reversion") {
    const lo = Number(s.rsiBuy ?? 30), hi = Number(s.rsiSell ?? 70);
    if (!ctx.holding && ind.rsi14 != null && ind.rsi14 <= lo) return { action: "buy", confidence: Math.min(0.9, 0.55 + (lo - ind.rsi14) / 40), reason: `Oversold: RSI ${f(ind.rsi14, 0)} ≤ ${lo}`, checks };
    if (ctx.holding && ind.rsi14 != null && ind.rsi14 >= hi) return { action: "sell", confidence: 0.7, reason: `Overbought: RSI ${f(ind.rsi14, 0)} ≥ ${hi}`, checks };
    return { action: "hold", confidence: 0.3, reason: `RSI ${f(ind.rsi14, 0)} between ${lo} and ${hi}`, checks };
  }
  if (kind === "breakout") {
    const vr = Number(s.minVolumeRise ?? 1.3);
    if (!ctx.holding && ind.high20 != null && ind.price > ind.high20 && (ind.volumeRise ?? vr) >= vr) return { action: "buy", confidence: 0.7, reason: `Breakout above 20-bar high ${ind.high20.toPrecision(6)} on volume ×${f(ind.volumeRise, 2)}`, checks };
    if (ctx.holding && ind.low20 != null && ind.price < ind.low20) return { action: "sell", confidence: 0.7, reason: `Broke below 20-bar low ${ind.low20.toPrecision(6)}`, checks };
    return { action: "hold", confidence: 0.3, reason: "No breakout", checks };
  }
  if (kind === "dip") {
    const dip = Number(s.dipPct ?? 3), ref = ctx.ref ?? ind.high20;
    const drop = ref ? pct(ind.price, ref) : 0;
    if (!ctx.holding && ref && drop <= -dip) return { action: "buy", confidence: Math.min(0.9, 0.55 + Math.abs(drop) / 30), reason: `Dip of ${f(drop, 2)}% from ${ref.toPrecision(6)} (target −${dip}%)`, checks };
    return { action: "hold", confidence: 0.3, reason: ctx.holding ? "Holding for take-profit" : `Waiting for a ${dip}% dip (now ${f(drop, 2)}%)`, checks };
  }
  if (kind === "dca") {
    const every = Number(s.everyHours ?? 24) * 3600_000, now = ctx.now ?? Date.now();
    if (!ctx.lastBuyAt || now - ctx.lastBuyAt >= every) return { action: "buy", confidence: 0.8, reason: `Scheduled accumulation (every ${s.everyHours ?? 24}h)`, checks };
    return { action: "hold", confidence: 0.2, reason: `Next accumulation in ${Math.ceil((every - (now - ctx.lastBuyAt)) / 3600_000)}h`, checks };
  }
  return { action: "hold", confidence: 0, reason: "Analysis-only strategy", checks };
}

/** Bar-by-bar backtest of an agent strategy on real history, with fees, slippage and exits. */
export function backtestStrategy(strategy: any, bars: Bars & { ts?: number[] }, opts: { startCash?: number; feeBps?: number; slippageBps?: number; barMs?: number } = {}) {
  const start = opts.startCash ?? 10_000, fee = (opts.feeBps ?? 30) / 1e4, slip = (opts.slippageBps ?? 10) / 1e4;
  const tp = Number(strategy?.takeProfitPct ?? 0), sl = Number(strategy?.stopLossPct ?? 0), size = Math.min(Number(strategy?.tradeUsd ?? 100) * 10, start);
  let cash = start, qty = 0, entry = 0, peak = start, maxDD = 0, wins = 0, losses = 0, gp = 0, gl = 0, lastBuy: number | null = null;
  const rets: number[] = []; let prevEq = start;
  const equity: { t: number; v: number }[] = [], trades: { t: number; side: "buy" | "sell"; price: number; pnl?: number }[] = [];
  const barMs = opts.barMs ?? 3600_000, every = Math.max(1, Math.floor(bars.close.length / 300));
  for (let i = 30; i < bars.close.length; i++) {
    const from = Math.max(0, i - 200);
    const slice: Bars = { close: bars.close.slice(from, i + 1), volume: bars.volume.slice(from, i + 1), high: bars.high.slice(from, i + 1), low: bars.low.slice(from, i + 1) };
    const t = bars.ts?.[i] ?? i * barMs;
    const ind = indicators(slice), px = ind.price;
    let action: "buy" | "sell" | "hold" = decide(strategy, ind, { holding: qty > 0, lastBuyAt: lastBuy, now: t }).action;
    if (qty > 0 && ((tp && px >= entry * (1 + tp / 100)) || (sl && px <= entry * (1 - sl / 100)))) action = "sell";
    if (action === "buy" && qty === 0 && cash > 1) { const n = Math.min(size, cash / (1 + fee)), fp = px * (1 + slip); qty = n / fp; entry = fp; cash -= n * (1 + fee); lastBuy = t; trades.push({ t, side: "buy", price: fp }); }
    else if (action === "sell" && qty > 0) { const fp = px * (1 - slip), pnl = (fp - entry) * qty - fp * qty * fee; cash += fp * qty * (1 - fee); qty = 0; trades.push({ t, side: "sell", price: fp, pnl }); if (pnl >= 0) { wins++; gp += pnl; } else { losses++; gl -= pnl; } }
    const eq = cash + qty * px; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, (peak - eq) / peak);
    rets.push(prevEq ? (eq - prevEq) / prevEq : 0); prevEq = eq;
    if ((i - 30) % every === 0 || i === bars.close.length - 1) equity.push({ t, v: eq });
  }
  const end = cash + qty * (bars.close.at(-1) ?? 0);
  const mean = rets.reduce((a, x) => a + x, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, rets.length));
  return {
    returnPct: ((end - start) / start) * 100, maxDrawdownPct: maxDD * 100, trades: wins + losses, winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
    profitFactor: gl > 0 ? gp / gl : null, sharpe: sd > 0 ? (mean / sd) * Math.sqrt((365 * 86_400_000) / barMs) : null, bars: bars.close.length,
    equity, tradeLog: trades.slice(-300), startValue: start, endValue: end,
    assumptions: { feeBps: opts.feeBps ?? 30, slippageBps: opts.slippageBps ?? 10 },
  };
}
