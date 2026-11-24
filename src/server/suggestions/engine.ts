import "@/lib/server-only-shim";
import { one, q } from "../db";

/**
 * Live suggestions generated from current market data + the user's own positions.
 * Deterministic and explainable (each suggestion shows the data that triggered it).
 * Suggestions are ideas, not advice: every one still goes through the engine preview + approval.
 */
export interface Suggestion {
  id: string;
  kind: "trade" | "prompt" | "shortcut";
  title: string;
  rationale: string;
  strength: "low" | "medium" | "high";
  assetId?: string;
  symbol?: string;
  /** For trades / order shortcuts: an engine OrderIntent to preview. */
  intent?: Record<string, unknown>;
  /** For prompt suggestions / prompt shortcuts. */
  prompt?: string;
  /** For "save as shortcut". */
  shortcut?: { name: string; icon: string; actions: any[]; placement: string[] };
  tags: string[];
}

const pct = (a: number, b: number) => ((a - b) / b) * 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
const niceUsd = (n: number) => (n >= 1000 ? Math.round(n / 50) * 50 : n >= 100 ? Math.round(n / 10) * 10 : Math.max(5, Math.round(n / 5) * 5));

async function assetSignals(assetId: string) {
  const a = await one<any>("SELECT * FROM assets WHERE id=$1", [assetId]);
  if (!a?.last_price) return null;
  const bars = (await q<any>("SELECT close, high, low FROM price_bars WHERE asset_id=$1 AND timeframe='1h' ORDER BY ts DESC LIMIT 72", [assetId])).reverse().map((b) => ({ c: Number(b.close), h: Number(b.high), l: Number(b.low) }));
  if (bars.length < 25) return null;
  const px = Number(a.last_price);
  const last24 = bars.slice(-24);
  const high24 = Math.max(...last24.map((b) => b.h), px), low24 = Math.min(...last24.map((b) => b.l), px);
  const sma = (n: number, off = 0) => bars.slice(bars.length - n - off, bars.length - off).reduce((s, b) => s + b.c, 0) / n;
  const rets = bars.slice(1).map((b, i) => Math.abs(pct(b.c, bars[i].c)));
  const vol1h = rets.slice(-24).reduce((s, v) => s + v, 0) / Math.min(24, rets.length); // avg abs hourly move %
  const volPrev = rets.slice(-72, -24).reduce((s, v) => s + v, 0) / Math.max(1, rets.slice(-72, -24).length);
  return { a, px, high24, low24, sma20: sma(20), sma20prev: sma(20, 3), sma50: bars.length >= 50 ? sma(50) : null, vol1h, volPrev,
    fromHigh: pct(px, high24), fromLow: pct(px, low24) };
}

export async function suggestionsFor(userId: string, assetId?: string | null): Promise<{ suggestions: Suggestion[]; asOf: string; dataSource: string | null }> {
  const out: Suggestion[] = [];
  const risk = await one<any>("SELECT max_order_usd FROM risk_settings WHERE user_id=$1", [userId]);
  const paper = await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId]);
  const cash = Number(paper?.cash_balance ?? 0);
  const baseSize = niceUsd(Math.min(Number(risk?.max_order_usd ?? 1000) * 0.25, Math.max(cash * 0.01, 25)));
  let dataSource: string | null = null;

  // Candidate assets: the asset on screen, the user's holdings, watchlist, then top movers.
  const ids = new Set<string>();
  if (assetId) ids.add(assetId);
  if (!assetId) {
    for (const r of await q<any>("SELECT asset_id FROM positions WHERE user_id=$1 AND quantity>0 ORDER BY updated_at DESC LIMIT 4", [userId])) ids.add(r.asset_id);
    for (const r of await q<any>("SELECT wi.asset_id FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id WHERE w.user_id=$1 LIMIT 4", [userId])) ids.add(r.asset_id);
    for (const r of await q<any>("SELECT id FROM assets WHERE tradability IN ('paper_tradable','live_tradable') AND NOT ('demo_data'=ANY(risk_flags)) AND last_price IS NOT NULL ORDER BY abs(COALESCE(change_24h,0)) DESC LIMIT 4")) ids.add(r.id);
  }

  for (const id of [...ids].slice(0, 8)) {
    const s = await assetSignals(id);
    if (!s) continue;
    const { a, px } = s;
    dataSource ??= a.price_source;
    const sym = a.symbol;
    const pos = await one<any>("SELECT quantity, avg_cost FROM positions WHERE user_id=$1 AND asset_id=$2 AND quantity>0", [userId, id]);
    const tag = a.price_source === "simulated" ? ["simulated data"] : [];
    const dipPct = r2(Math.min(Math.max(s.vol1h * 3, 1), 12));  // ~3 typical hourly moves
    const tpPct = r2(Math.min(Math.max(dipPct * 1.6, 1.5), 20));

    // 1) Pulled back from the 24h high → dip-buy idea + loop prompt
    if (s.fromHigh <= -Math.max(dipPct, 2)) {
      out.push({ id: `dip-${id}`, kind: "trade", assetId: id, symbol: sym, strength: s.fromHigh <= -2 * dipPct ? "high" : "medium", tags: ["dip", ...tag],
        title: `Buy ${sym} on the ${Math.abs(r2(s.fromHigh))}% pullback`,
        rationale: `${sym} is ${Math.abs(r2(s.fromHigh))}% below its 24h high (${s.high24.toPrecision(6)}); typical hourly move is ${r2(s.vol1h)}%. Suggested stop ${r2(dipPct * 1.5)}% below entry.`,
        intent: { asset: { assetId: id }, side: "buy", orderType: "market", notionalUsd: baseSize, stopLoss: +(px * (1 - (dipPct * 1.5) / 100)).toPrecision(8), timeInForce: "gtc" } });
    }
    // 2) Trend: price above a rising SMA20 (and SMA50)
    if (px > s.sma20 && s.sma20 > s.sma20prev && (!s.sma50 || s.sma20 > s.sma50) && !pos) {
      out.push({ id: `trend-${id}`, kind: "trade", assetId: id, symbol: sym, strength: s.sma50 ? "medium" : "low", tags: ["momentum", ...tag],
        title: `Small momentum entry in ${sym}`,
        rationale: `Price ${px.toPrecision(6)} is above a rising 20-hour average (${s.sma20.toPrecision(6)})${s.sma50 ? ` which is above the 50-hour average` : ""}. Trend-following entries work only while the trend lasts — use a stop.`,
        intent: { asset: { assetId: id }, side: "buy", orderType: "market", notionalUsd: niceUsd(baseSize / 2), stopLoss: +(Math.min(s.sma20, px * 0.97)).toPrecision(8), timeInForce: "gtc" } });
    }
    // 3) Position management
    if (pos) {
      const g = pct(px, Number(pos.avg_cost));
      if (g >= Math.max(tpPct, 5)) out.push({ id: `tp-${id}`, kind: "trade", assetId: id, symbol: sym, strength: g >= 15 ? "high" : "medium", tags: ["take profit", ...tag],
        title: `Lock in gains: sell 25% of ${sym}`, rationale: `Your ${sym} position is up ${r2(g)}% from your average cost ${Number(pos.avg_cost).toPrecision(6)}.`,
        intent: { asset: { assetId: id }, side: "sell", orderType: "market", percentOfPosition: 25, timeInForce: "gtc" } });
      if (g <= -Math.max(dipPct * 1.5, 5)) out.push({ id: `cut-${id}`, kind: "trade", assetId: id, symbol: sym, strength: "medium", tags: ["risk", ...tag],
        title: `Review ${sym}: down ${Math.abs(r2(g))}%`, rationale: `Position is ${Math.abs(r2(g))}% below cost. Consider reducing size or setting a stop rather than averaging down blindly.`,
        intent: { asset: { assetId: id }, side: "sell", orderType: "market", percentOfPosition: 50, timeInForce: "gtc" } });
    }
    // 4) Volatility regime change → smaller sizes / alert
    if (s.volPrev > 0 && s.vol1h > s.volPrev * 1.8) out.push({ id: `vol-${id}`, kind: "prompt", assetId: id, symbol: sym, strength: "medium", tags: ["volatility", ...tag],
      title: `${sym} volatility jumped ${r2(s.vol1h / s.volPrev)}×`, rationale: `Average hourly move rose from ${r2(s.volPrev)}% to ${r2(s.vol1h)}%. An alert at the 24h low can help.`,
      prompt: `Notify me when ${sym} drops below ${s.low24.toPrecision(6)}` });

    // Prompt + shortcut suggestions tuned to this asset's live volatility
    out.push({ id: `loop-${id}`, kind: "prompt", assetId: id, symbol: sym, strength: "low", tags: ["bot", ...tag],
      title: `${sym} dip-loop sized to current volatility`, rationale: `Uses ~3× the typical hourly move (${r2(s.vol1h)}%) as the dip trigger and ${tpPct}% as the target.`,
      prompt: `Buy $${baseSize} of ${sym} at a ${dipPct}% dip and sell at ${tpPct}% increase, then rinse and repeat` });
    out.push({ id: `sc-buy-${id}`, kind: "shortcut", assetId: id, symbol: sym, strength: "low", tags: ["one-tap", ...tag],
      title: `Buy $${baseSize} ${sym} + ${r2(dipPct * 1.5)}% stop`, rationale: `One-tap entry sized at ~25% of your max order with a volatility-based stop.`,
      intent: { asset: { assetId: id }, side: "buy", orderType: "market", notionalUsd: baseSize, stopLoss: +(px * (1 - (dipPct * 1.5) / 100)).toPrecision(8), timeInForce: "gtc" },
      shortcut: { name: `Buy $${baseSize} + stop`.slice(0, 40), icon: "zap", placement: ["terminal", "dashboard"], actions: [{ type: "buy_usd", amount: baseSize, orderType: "market" }, { type: "set_stop_loss_pct", amount: r2(dipPct * 1.5), orderType: "market" }] } });
    if (pos) out.push({ id: `sc-sell-${id}`, kind: "shortcut", assetId: id, symbol: sym, strength: "low", tags: ["one-tap", ...tag],
      title: `Sell 25% ${sym}`, rationale: "Quick partial exit for your open position.",
      intent: { asset: { assetId: id }, side: "sell", orderType: "market", percentOfPosition: 25, timeInForce: "gtc" },
      shortcut: { name: "Sell 25%", icon: "trending-down", placement: ["terminal", "dashboard"], actions: [{ type: "sell_pct", amount: 25, orderType: "market" }] } });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((x, y) => rank[x.strength] - rank[y.strength]);
  return { suggestions: out.slice(0, assetId ? 10 : 14), asOf: new Date().toISOString(), dataSource };
}
