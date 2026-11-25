import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { publish } from "../realtime";
import { place, notify } from "../engine/engine";
import { backtest } from "../bots/runner";
import { isRealSource } from "../ai/market-answers";
import { think as modoThink } from "../modo/engine";

/**
 * AUTO TRADING (owner only)
 * Each minute, for every candidate asset Merod collects five data points, each scored from -1 (sell) to +1 (buy):
 *   merod       — what other Merod traders are net buying/selling (last 6h, anonymous totals)
 *   thirdParty  — trades by traders outside Merod: followed public wallets and consenting traders' outside brokers (24h)
 *   modo        — Modo's latest idea on the asset (direction × confidence)
 *   backtest    — SMA-crossover backtest on the asset's REAL hourly history (reliability) × the current signal direction
 *   momentum    — the 24h price move
 * The weighted score (weights learned from outcomes) decides the trade. Every decision is FIRST taken as a theoretical
 * trade (no order: entry price recorded and graded later). Real orders only start once the theoretical record has enough
 * trades with a good enough win rate, and every result, theoretical or real, re-weights the data points.
 * Modo explains each trade before (data points), during (order outcome) and after (result + what it learned).
 * The switch stops everything immediately. Only real market prices are used; real-money orders still need the
 * platform's "automated real money" flag and pass every risk check in the order engine.
 */
export type Weights = { merod: number; thirdParty: number; modo: number; backtest: number; momentum: number };
export const DEFAULT_WEIGHTS: Weights = { merod: 1, thirdParty: 1, modo: 1, backtest: 1, momentum: 1 };
export const LABEL: Record<keyof Weights, string> = { merod: "Merod traders", thirdParty: "Outside traders", modo: "Modo", backtest: "Backtest", momentum: "Momentum" };
type Signal = { value: number; evidence: string };
type Signals = Record<keyof Weights, Signal>;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const pctTxt = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
const money = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}`;

/* ───────────────────────── Settings & switch ───────────────────────── */
export async function getSettings(userId: string) {
  return (await one<any>("SELECT * FROM auto_trading WHERE user_id=$1", [userId]))
    ?? { user_id: userId, enabled: false, account_id: null, markets: "both", trade_usd: 100, max_daily_usd: 500, max_open: 5, min_confidence: 0.6,
         min_theory_trades: 5, min_theory_win_rate: 0.55, take_profit_pct: 4, stop_loss_pct: 2, weights: DEFAULT_WEIGHTS, last_run_at: null,
         asset_ids: [], modo_autopilot: false, modo_min_confidence: 0.5, modo_last_run_at: null, modo_thoughts: [] };
}

export async function saveSettings(userId: string, patch: Partial<{ enabled: boolean; accountId: string | null; markets: string; tradeUsd: number; maxDailyUsd: number; maxOpen: number;
  minConfidence: number; minTheoryTrades: number; minTheoryWinRate: number; takeProfitPct: number; stopLossPct: number }>) {
  if (patch.accountId) {
    const a = await one("SELECT 1 FROM trading_accounts WHERE id=$1 AND user_id=$2 AND status='active'", [patch.accountId, userId]);
    if (!a) throw new HttpError(400, "That trading account isn't yours or isn't active");
  }
  const cur = await getSettings(userId);
  const n = {
    enabled: patch.enabled ?? cur.enabled, account_id: patch.accountId !== undefined ? patch.accountId : cur.account_id, markets: patch.markets ?? cur.markets,
    trade_usd: patch.tradeUsd ?? cur.trade_usd, max_daily_usd: patch.maxDailyUsd ?? cur.max_daily_usd, max_open: patch.maxOpen ?? cur.max_open,
    min_confidence: patch.minConfidence ?? cur.min_confidence, min_theory_trades: patch.minTheoryTrades ?? cur.min_theory_trades,
    min_theory_win_rate: patch.minTheoryWinRate ?? cur.min_theory_win_rate, take_profit_pct: patch.takeProfitPct ?? cur.take_profit_pct, stop_loss_pct: patch.stopLossPct ?? cur.stop_loss_pct,
  };
  await q(`INSERT INTO auto_trading (user_id, enabled, account_id, markets, trade_usd, max_daily_usd, max_open, min_confidence, min_theory_trades, min_theory_win_rate, take_profit_pct, stop_loss_pct, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
           ON CONFLICT (user_id) DO UPDATE SET enabled=$2, account_id=$3, markets=$4, trade_usd=$5, max_daily_usd=$6, max_open=$7, min_confidence=$8, min_theory_trades=$9,
             min_theory_win_rate=$10, take_profit_pct=$11, stop_loss_pct=$12, updated_at=now()`,
    [userId, n.enabled, n.account_id, n.markets, n.trade_usd, n.max_daily_usd, n.max_open, n.min_confidence, n.min_theory_trades, n.min_theory_win_rate, n.take_profit_pct, n.stop_loss_pct]);
  if (patch.enabled !== undefined && patch.enabled !== cur.enabled)
    await audit({ actorType: "user", actorId: userId, userId, action: patch.enabled ? "auto.enabled" : "auto.disabled", data: {} });
  return getSettings(userId);
}

export async function theoryRecord(userId: string) {
  const r = await one<{ n: number; wins: number; avg: string }>(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE return_pct > 0)::int AS wins, COALESCE(avg(return_pct),0) AS avg
       FROM (SELECT return_pct FROM auto_trades WHERE user_id=$1 AND mode='theory' AND status='closed' ORDER BY closed_at DESC LIMIT 50) t`, [userId]);
  return { trades: r?.n ?? 0, wins: r?.wins ?? 0, winRate: r?.n ? r.wins / r.n : 0, avgReturnPct: Number(r?.avg ?? 0) };
}

/* ───────────────────────── Data points ───────────────────────── */
const btCache = new Map<string, { at: number; r: any }>();
async function backtestSignal(assetId: string): Promise<Signal> {
  let c = btCache.get(assetId);
  if (!c || Date.now() - c.at > 6 * 3600_000) {
    try { c = { at: Date.now(), r: await backtest("technical_indicator", assetId, { fast: 9, slow: 21, amount_usd: 1000 }, { timeframe: "1h" }) }; }
    catch (e: any) { c = { at: Date.now(), r: { error: e.message } }; }
    btCache.set(assetId, c);
  }
  const r = c.r;
  if (r.error) return { value: 0, evidence: `no backtest (${r.error})` };
  if (r.dataWarning) return { value: 0, evidence: "skipped: only simulated history available" };
  const bars = await q<{ close: string }>("SELECT close FROM price_bars WHERE asset_id=$1 AND timeframe='1h' ORDER BY ts DESC LIMIT 21", [assetId]);
  if (bars.length < 21) return { value: 0, evidence: "not enough real hourly history" };
  const closes = bars.map((b) => Number(b.close)).reverse();
  const avg = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const dir = Math.sign(avg(9) - avg(21));
  const edge = r.tradeCount >= 4 ? clamp(((r.winRate ?? 50) - 50) / 25 + (r.returnPct - r.buyHoldPct) / 20, -1, 1) : 0;
  const value = clamp(dir * Math.max(0, edge + 0.3), -1, 1);
  return { value, evidence: `SMA9 ${dir > 0 ? "above" : "below"} SMA21 now; this crossover won ${r.winRate != null ? `${r.winRate.toFixed(0)}%` : "n/a"} of ${r.tradeCount} backtest trades on ${r.bars} real hourly bars (${pctTxt(r.returnPct)} vs buy-and-hold ${pctTxt(r.buyHoldPct)})` };
}

export async function collectSignals(userId: string, a: any): Promise<Signals> {
  const crowd = await one<any>(
    `SELECT count(DISTINCT o.user_id)::int AS traders,
            COALESCE(sum(CASE WHEN o.side='buy' THEN o.filled_quantity*o.avg_fill_price ELSE -o.filled_quantity*o.avg_fill_price END),0) AS net,
            COALESCE(sum(o.filled_quantity*o.avg_fill_price),0) AS gross
       FROM orders o WHERE o.asset_id=$1 AND o.user_id<>$2 AND o.status IN ('filled','partially_filled') AND o.source NOT IN ('auto','copy') AND o.updated_at > now() - interval '6 hours'`, [a.id, userId]);
  const merod: Signal = Number(crowd?.gross) > 0
    ? { value: clamp(Number(crowd.net) / Number(crowd.gross), -1, 1), evidence: `${crowd.traders} Merod trader${crowd.traders === 1 ? "" : "s"} net ${Number(crowd.net) >= 0 ? "bought" : "sold"} ${money(Math.abs(Number(crowd.net)))} in 6h` }
    : { value: 0, evidence: "no Merod trading in 6h" };

  const ext = await one<any>(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE side='buy')::int AS buys FROM copy_trade_events
      WHERE asset_id=$1 AND origin IN ('broker','onchain') AND created_at > now() - interval '24 hours'`, [a.id]);
  const thirdParty: Signal = ext?.n
    ? { value: clamp((2 * ext.buys - ext.n) / ext.n, -1, 1) * Math.min(1, ext.n / 3), evidence: `${ext.n} trade${ext.n === 1 ? "" : "s"} by outside traders/wallets in 24h (${ext.buys} buys, ${ext.n - ext.buys} sells)` }
    : { value: 0, evidence: "no outside-trader activity in 24h" };

  const idea = await one<any>("SELECT side, confidence, thesis FROM modo_ideas WHERE user_id=$1 AND asset_id=$2 AND created_at > now() - interval '3 hours' ORDER BY created_at DESC LIMIT 1", [userId, a.id]);
  const modo: Signal = idea
    ? { value: (idea.side === "buy" ? 1 : -1) * Number(idea.confidence), evidence: `${idea.side} idea, ${Math.round(Number(idea.confidence) * 100)}% confidence: ${String(idea.thesis).slice(0, 140)}` }
    : { value: 0, evidence: "no recent Modo idea" };

  const ch = Number(a.change_24h ?? 0);
  const momentum: Signal = { value: clamp(ch / 10, -1, 1), evidence: `${pctTxt(ch)} in 24h (${a.price_source})` };
  return { merod, thirdParty, modo, backtest: await backtestSignal(a.id), momentum };
}

export function scoreSignals(s: Signals, w: Weights) {
  const keys = Object.keys(w) as (keyof Weights)[];
  const tot = keys.reduce((t, k) => t + w[k], 0) || 1;
  const score = keys.reduce((t, k) => t + w[k] * s[k].value, 0) / tot;
  const agree = keys.filter((k) => Math.abs(s[k].value) > 0.15 && Math.sign(s[k].value) === Math.sign(score)).length;
  const against = keys.filter((k) => Math.abs(s[k].value) > 0.15 && Math.sign(s[k].value) === -Math.sign(score)).length;
  const confidence = clamp(0.3 + 0.12 * agree - 0.1 * against + 0.6 * Math.abs(score), 0, 0.95);
  return { score, confidence, agree };
}

function explainBefore(symbol: string, side: string, s: Signals, w: Weights, sc: { score: number; confidence: number }, mode: string, why: string) {
  const pts = (Object.keys(s) as (keyof Weights)[]).map((k) => `• ${LABEL[k]} ${s[k].value >= 0 ? "+" : ""}${s[k].value.toFixed(2)} (weight ×${w[k].toFixed(2)}): ${s[k].evidence}`);
  return `${side === "buy" ? "Buying" : "Selling"} ${symbol} — score ${sc.score.toFixed(2)}, ${Math.round(sc.confidence * 100)}% confidence.\n${pts.join("\n")}\n${mode === "theory" ? `Theoretical trade (no order placed): ${why}` : `Real trade: ${why}`}`;
}

/* ───────────────────────── The loop ───────────────────────── */
async function livePrice(assetId: string) {
  const a = await one<any>("SELECT last_price, price_source, price_updated_at FROM assets WHERE id=$1", [assetId]);
  return a?.last_price && isRealSource(a.price_source) && Date.now() - new Date(a.price_updated_at).getTime() < 15 * 60_000 ? Number(a.last_price) : null;
}

async function accountFor(userId: string, accountId: string | null) {
  return accountId
    ? await one<any>("SELECT id, kind FROM trading_accounts WHERE id=$1 AND user_id=$2 AND status='active'", [accountId, userId])
    : await one<any>("SELECT id, kind FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId]);
}

/** Close one open auto trade at the live price (selling the real position if it is a real trade). Returns false if it couldn't close yet. */
export async function closeTrade(userId: string, t: any, px: number, reason: string): Promise<boolean> {
    let exitOrder: string | null = null, exitPx = px, during = "";
    if (t.mode === "real" && t.order_id) {
      const o = await one<any>("SELECT account_id, filled_quantity FROM orders WHERE id=$1", [t.order_id]);
      if (Number(o?.filled_quantity) > 0) {
        try {
          const { order } = await place({ asset: { assetId: t.asset_id }, side: "sell", orderType: "market", quantity: Number(o.filled_quantity), timeInForce: "gtc", accountId: o.account_id } as any,
            { userId, source: "auto", sourceRef: t.id, idempotencyKey: `auto-exit:${t.id}`, actor: { type: "system", id: "auto-trading" }, userConfirmed: (await accountFor(userId, o.account_id))?.kind === "paper" } as any);
          exitOrder = order.id; exitPx = Number(order.avg_fill_price) || px;
          during = ` Sell order ${order.status}${order.status_reason ? ` (${order.status_reason})` : ""}.`;
          if (!["filled", "partially_filled", "submitted"].includes(order.status)) return false; // try again next minute
        } catch (e: any) { await q("UPDATE auto_trades SET explain_during = COALESCE(explain_during,'') || $2 WHERE id=$1", [t.id, `\nExit failed: ${e.message}`]); return false; }
      }
    }
    const finalRet = (exitPx / Number(t.entry_price) - 1) * 100;
    const right = (Object.entries(t.signals) as [keyof Weights, Signal][]).filter(([, s]) => Math.abs(s.value) > 0.15);
    const good = right.filter(([, s]) => Math.sign(s.value) * finalRet > 0).map(([k]) => LABEL[k]);
    const bad = right.filter(([, s]) => Math.sign(s.value) * finalRet <= 0).map(([k]) => LABEL[k]);
    const after = `Closed at ${money(exitPx)}: ${pctTxt(finalRet)} (${reason}).${during} ${good.length ? `Right: ${good.join(", ")}.` : ""} ${bad.length ? `Wrong: ${bad.join(", ")}.` : ""} I'll weigh those data points accordingly.`.replace(/\s+/g, " ").trim();
    await q("UPDATE auto_trades SET status='closed', exit_price=$2, return_pct=$3, exit_order_id=$4, explain_after=$5, closed_at=now() WHERE id=$1", [t.id, exitPx, finalRet, exitOrder, after]);
    await publish(`user:${userId}`, "auto", { id: t.id, phase: "after", symbol: t.symbol });
    if (t.mode === "real") await notify(userId, "auto", `Auto trade closed: ${t.symbol} ${pctTxt(finalRet)}`, after, "/auto").catch(() => {});
    return true;
}

/** Close theory/real trades that hit take-profit, stop-loss or 24h. */
export async function manageOpen(userId: string, cfg: any) {
  const open = await q<any>("SELECT * FROM auto_trades WHERE user_id=$1 AND status='open' ORDER BY created_at", [userId]);
  let closed = 0;
  for (const t of open) {
    const px = await livePrice(t.asset_id);
    if (!px || !t.entry_price) continue;
    const ret = (px / Number(t.entry_price) - 1) * 100;
    const ageH = (Date.now() - new Date(t.created_at).getTime()) / 3_600_000;
    const reason = ret >= Number(cfg.take_profit_pct) ? `take-profit (+${cfg.take_profit_pct}%) reached`
      : ret <= -Number(cfg.stop_loss_pct) ? `stop-loss (−${cfg.stop_loss_pct}%) reached` : ageH >= 24 ? "24-hour time limit" : null;
    if (reason && await closeTrade(userId, t, px, reason)) closed++;
  }
  if (closed) await learn(userId);
  return closed;
}

/** Close open trades matching a filter (used by scheduled tasks). */
export async function sweep(userId: string, which: "winners" | "losers", reason: string) {
  const open = await q<any>("SELECT * FROM auto_trades WHERE user_id=$1 AND status='open'", [userId]);
  let n = 0;
  for (const t of open) {
    const px = await livePrice(t.asset_id);
    if (!px || !t.entry_price) continue;
    const ret = (px / Number(t.entry_price) - 1) * 100;
    if ((which === "winners" ? ret > 0 : ret < 0) && await closeTrade(userId, t, px, reason)) n++;
  }
  if (n) await learn(userId);
  return n;
}

/** Re-weight each data point by how often it pointed the right way (theoretical and real results). */
export async function learn(userId: string) {
  const rows = await q<any>("SELECT signals, return_pct FROM auto_trades WHERE user_id=$1 AND status='closed' AND return_pct IS NOT NULL ORDER BY closed_at DESC LIMIT 200", [userId]);
  const cfg = await getSettings(userId);
  const w: Weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights ?? {}) };
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
    const used = rows.filter((r) => Math.abs(r.signals?.[k]?.value ?? 0) > 0.15);
    if (used.length < 5) continue;
    const hit = used.filter((r) => Math.sign(r.signals[k].value) * Number(r.return_pct) > 0).length / used.length;
    w[k] = +clamp(w[k] * 0.7 + 0.3 * (hit * 2), 0.2, 2).toFixed(3);
  }
  await q("UPDATE auto_trading SET weights=$2 WHERE user_id=$1", [userId, JSON.stringify(w)]);
  return w;
}

/** How each strategy leans on the data points (multiplies the learned weights). */
export const STRATEGY_KINDS: Record<string, { label: string; lean: Partial<Weights>; note: string }> = {
  multi_asset: { label: "Multi-Asset Officer", lean: {}, note: "All five data points, as learned" },
  momentum: { label: "Momentum Pro", lean: { momentum: 2, backtest: 1.5 }, note: "Rides assets already moving, confirmed by the backtest" },
  rotation: { label: "Crypto Rotation", lean: { momentum: 1.5, merod: 1.5, thirdParty: 1.5 }, note: "Rotates into the coins traders are moving into" },
  breakout: { label: "Breakout Hunter", lean: { backtest: 2, momentum: 1.5 }, note: "Waits for a fresh trend signal on real price history" },
  ai_swing: { label: "AI Swing", lean: { modo: 2.5 }, note: "Follows Modo's ideas most of all" },
};

async function strategyCandidates(userId: string) {
  return q<any>(
    `SELECT a.*, s.id AS strategy_id, s.kind AS strategy_kind, s.name AS strategy_name FROM auto_strategies s
       JOIN assets a ON a.id = ANY(s.asset_ids)
      WHERE s.user_id=$1 AND s.enabled AND a.last_price IS NOT NULL AND a.price_source IS NOT NULL AND a.price_source <> 'simulated'
        AND a.price_updated_at > now() - interval '15 minutes' AND a.tradability IN ('paper_tradable','live_tradable')`, [userId]);
}

async function candidates(userId: string, markets: string) {
  const cls = markets === "crypto" ? ["crypto"] : markets === "stocks" ? ["stock", "etf"] : ["crypto", "stock", "etf"];
  return q<any>(
    `SELECT a.* FROM assets a
      WHERE a.asset_class = ANY($2::text[]) AND a.last_price IS NOT NULL AND a.price_source IS NOT NULL AND a.price_source <> 'simulated'
        AND a.price_updated_at > now() - interval '15 minutes' AND NOT ('demo_data' = ANY(a.risk_flags)) AND a.tradability IN ('paper_tradable','live_tradable')
        AND (a.id IN (SELECT asset_id FROM modo_ideas WHERE user_id=$1 AND created_at > now() - interval '3 hours')
          OR a.id IN (SELECT asset_id FROM orders WHERE user_id<>$1 AND updated_at > now() - interval '6 hours' AND status='filled')
          OR a.id IN (SELECT asset_id FROM copy_trade_events WHERE origin IN ('broker','onchain') AND created_at > now() - interval '24 hours')
          OR a.market_cap IS NOT NULL)
      ORDER BY a.market_cap DESC NULLS LAST LIMIT 12`, [userId, cls]);
}

/** One pass for one user: manage open trades, then look for new ones. */
export async function runFor(userId: string) {
  const cfg = await getSettings(userId);
  if (!cfg.enabled) return { skipped: "off" };
  await q("UPDATE auto_trading SET last_run_at=now() WHERE user_id=$1", [userId]);
  await manageOpen(userId, cfg);
  const w: Weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights ?? {}) };
  const record = await theoryRecord(userId);
  const proven = record.trades >= Number(cfg.min_theory_trades) && record.winRate >= Number(cfg.min_theory_win_rate);
  const openRows = await q<any>("SELECT asset_id, mode FROM auto_trades WHERE user_id=$1 AND status='open'", [userId]);
  const openAssets = new Set(openRows.map((r) => r.asset_id));
  const realOpen = openRows.filter((r) => r.mode === "real").length;
  const spent = Number((await one<{ s: string }>(
    `SELECT COALESCE(sum(o.notional_usd),0) AS s FROM auto_trades t JOIN orders o ON o.id=t.order_id WHERE t.user_id=$1 AND t.mode='real' AND t.created_at > now() - interval '24 hours'`, [userId]))?.s ?? 0);
  let made = 0;
  // Strategy assets first (each with its own lean), then hand-picked assets, then Merod's own picks.
  const strat = await strategyCandidates(userId);
  const picked = (cfg.asset_ids ?? []).length ? await q<any>(
    `SELECT * FROM assets WHERE id = ANY($1::uuid[]) AND last_price IS NOT NULL AND price_source IS NOT NULL AND price_source <> 'simulated' AND price_updated_at > now() - interval '15 minutes'`, [cfg.asset_ids]) : [];
  const pool = [...strat, ...picked, ...(strat.length || picked.length ? [] : await candidates(userId, cfg.markets))];
  const seen = new Set<string>();
  for (const a of pool) {
    if (openAssets.has(a.id) || seen.has(a.id)) continue;
    seen.add(a.id);
    const s = await collectSignals(userId, a);
    const lean = STRATEGY_KINDS[a.strategy_kind ?? "multi_asset"]?.lean ?? {};
    const wl = Object.fromEntries((Object.keys(w) as (keyof Weights)[]).map((k) => [k, w[k] * (lean[k] ?? 1)])) as Weights;
    const sc = scoreSignals(s, wl);
    if (sc.score <= 0 || sc.confidence < Number(cfg.min_confidence)) continue; // opens are buys only; no shorting
    const px = await livePrice(a.id);
    if (!px) continue;
    const canReal = proven && realOpen + made < Number(cfg.max_open) && spent + Number(cfg.trade_usd) * (made + 1) <= Number(cfg.max_daily_usd);
    const why = canReal
      ? `theoretical record ${record.wins}/${record.trades} wins (${Math.round(record.winRate * 100)}%) clears the bar, so placing a ${money(Number(cfg.trade_usd))} order.`
      : !proven
        ? `building the theoretical record first (${record.wins}/${record.trades} wins; needs ${cfg.min_theory_trades}+ trades at ${Math.round(Number(cfg.min_theory_win_rate) * 100)}%+ before real orders).`
        : `real-trade limits reached (max ${cfg.max_open} open / ${money(Number(cfg.max_daily_usd))} a day), so testing it theoretically.`;
    const mode = canReal ? "real" : "theory";
    const before = (a.strategy_name ? `[${a.strategy_name}] ` : "") + explainBefore(a.symbol, "buy", s, wl, sc, mode, why);
    const row = await one<{ id: string }>(
      `INSERT INTO auto_trades (user_id, asset_id, symbol, side, mode, status, signals, score, confidence, entry_price, explain_before, strategy_id)
       VALUES ($1,$2,$3,'buy',$4,'open',$5,$6,$7,$8,$9,$10) RETURNING id`, [userId, a.id, a.symbol, mode, JSON.stringify(s), sc.score, sc.confidence, px, before, a.strategy_id ?? null]);
    made++;
    if (mode === "real") {
      const account = await accountFor(userId, cfg.account_id);
      if (!account) { await q("UPDATE auto_trades SET status='failed', explain_during='Your auto-trading account is missing or inactive.' WHERE id=$1", [row!.id]); continue; }
      try {
        const { order } = await place({ asset: { assetId: a.id }, side: "buy", orderType: "market", notionalUsd: Number(cfg.trade_usd), timeInForce: "gtc", accountId: account.id } as any,
          { userId, source: "auto", sourceRef: row!.id, idempotencyKey: `auto:${row!.id}`, actor: { type: "system", id: "auto-trading" },
            // Paper runs automatically; real money also needs the platform's "automated real money" flag (checked by the engine).
            userConfirmed: account.kind === "paper" } as any);
        const ok = ["filled", "partially_filled", "submitted"].includes(order.status);
        const fill = Number(order.avg_fill_price) || null;
        const during = ok ? `Order ${order.status}${fill ? ` at ${money(fill)}` : ""} in your ${account.kind === "paper" ? "paper" : "live"} account. Watching for +${cfg.take_profit_pct}% / −${cfg.stop_loss_pct}% or 24h.`
          : order.status === "pending_approval" ? "Order is waiting for your approval in Portfolio → Orders (real-money automation needs approval)." : `Order ${order.status}: ${order.status_reason ?? "rejected by the risk checks"}.`;
        await q(`UPDATE auto_trades SET order_id=$2, explain_during=$3, entry_price=COALESCE($4, entry_price), status=CASE WHEN $5 THEN 'open' WHEN $6 THEN 'open' ELSE 'failed' END WHERE id=$1`,
          [row!.id, order.id, during, fill, ok, order.status === "pending_approval"]);
        await notify(userId, "auto", `Auto trade: bought ${a.symbol}`, during, "/auto").catch(() => {});
      } catch (e: any) {
        await q("UPDATE auto_trades SET status='failed', explain_during=$2 WHERE id=$1", [row!.id, `Order failed: ${e.message}`]);
      }
    } else {
      await q("UPDATE auto_trades SET explain_during=$2 WHERE id=$1", [row!.id, `Tracking theoretically from ${money(px)}; graded at +${cfg.take_profit_pct}% / −${cfg.stop_loss_pct}% or after 24h.`]);
    }
    await publish(`user:${userId}`, "auto", { id: row!.id, phase: "before", symbol: a.symbol, mode });
    if (made >= 3) break; // at most 3 new decisions a minute
  }
  return { made };
}

/** Worker entry: every enabled owner account. */
export async function runAutoTrading() {
  const users = await q<{ user_id: string }>(
    `SELECT t.user_id FROM auto_trading t JOIN users u ON u.id=t.user_id AND u.role='super_admin'
      WHERE t.enabled AND (t.last_run_at IS NULL OR t.last_run_at < now() - interval '50 seconds')`);
  let n = 0;
  for (const u of users) { try { const r = await runFor(u.user_id); n += (r as any).made ?? 0; } catch (e: any) { console.error("[auto]", e.message); } }
  return n;
}

export async function overview(userId: string) {
  const [settings, record, trades] = await Promise.all([getSettings(userId), theoryRecord(userId),
    q<any>("SELECT * FROM auto_trades WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40", [userId])]);
  const real = await one<any>("SELECT count(*)::int AS n, count(*) FILTER (WHERE return_pct>0)::int AS wins, COALESCE(sum(return_pct),0) AS sum FROM auto_trades WHERE user_id=$1 AND mode='real' AND status='closed'", [userId]);
  return { settings: { ...settings, weights: { ...DEFAULT_WEIGHTS, ...(settings.weights ?? {}) } }, theory: record,
    real: { trades: real?.n ?? 0, wins: real?.wins ?? 0, totalReturnPct: Number(real?.sum ?? 0) }, trades };
}

/* ───────────────────────── Modo Autopilot ───────────────────────── */
/**
 * Modo scans news and markets (headlines, other traders' flow weighted by how profitable they've been, momentum,
 * your book), and trades its own ideas directly: buys on buy ideas, sells its open trades on sell ideas. There is no cap
 * on how many trades it takes. Every result feeds back into the learned weights (Modo's own grading + these trades).
 * Real-money orders still need the platform's real-money switches and pass every risk check in the order engine.
 */
export async function setModoAutopilot(userId: string, on: boolean, minConfidence?: number) {
  await getSettings(userId);
  await q(`INSERT INTO auto_trading (user_id, modo_autopilot, modo_min_confidence) VALUES ($1,$2,COALESCE($3,0.5))
           ON CONFLICT (user_id) DO UPDATE SET modo_autopilot=$2, modo_min_confidence=COALESCE($3, auto_trading.modo_min_confidence), updated_at=now()`, [userId, on, minConfidence ?? null]);
  await audit({ actorType: "user", actorId: userId, userId, action: on ? "modo_autopilot.enabled" : "modo_autopilot.disabled", data: {} });
}

export async function runModoAutopilotFor(userId: string) {
  const cfg = await getSettings(userId);
  if (!cfg.modo_autopilot) return { skipped: "off" };
  await q("UPDATE auto_trading SET modo_last_run_at=now() WHERE user_id=$1", [userId]);
  await manageOpen(userId, cfg); // exits (take-profit / stop-loss / 24h) and learning on every pass
  const thoughts: { text: string; kind: string; at: number }[] = [];
  const ideas = await modoThink(userId, (text, kind = "think") => { thoughts.push({ text, kind, at: Date.now() }); });
  const account = await accountFor(userId, cfg.account_id);
  let bought = 0, sold = 0;
  for (const idea of ideas) {
    const conf = Number(idea.confidence);
    if (idea.side === "sell") {
      const open = await q<any>("SELECT * FROM auto_trades WHERE user_id=$1 AND asset_id=$2 AND status='open'", [userId, idea.asset_id]);
      for (const t of open) {
        const px = await livePrice(t.asset_id);
        if (px && await closeTrade(userId, t, px, `Modo sell signal: ${String(idea.thesis).slice(0, 120)}`)) { sold++; thoughts.push({ text: `Sold my ${t.symbol} trade: ${idea.thesis}`, kind: "idea", at: Date.now() }); }
      }
      continue;
    }
    if (conf < Number(cfg.modo_min_confidence)) { thoughts.push({ text: `Not trading ${idea.symbol}: ${Math.round(conf * 100)}% confidence is under my ${Math.round(Number(cfg.modo_min_confidence) * 100)}% bar.`, kind: "think", at: Date.now() }); continue; }
    if (await one("SELECT 1 FROM auto_trades WHERE user_id=$1 AND asset_id=$2 AND status='open'", [userId, idea.asset_id])) continue;
    const px = await livePrice(idea.asset_id);
    if (!px) { thoughts.push({ text: `Skipping ${idea.symbol}: no live price from a real data source right now.`, kind: "warn", at: Date.now() }); continue; }
    if (!account) { thoughts.push({ text: "No trading account to use.", kind: "warn", at: Date.now() }); break; }
    const sig = idea.signals ?? {};
    const signals: Signals = {
      merod: { value: Number(sig.crowd ?? 0), evidence: "other Merod traders' flow (profitable traders weigh more)" },
      thirdParty: { value: 0, evidence: "not used by Modo Autopilot" },
      modo: { value: conf, evidence: String(idea.thesis).slice(0, 160) },
      backtest: { value: 0, evidence: "not used by Modo Autopilot" },
      momentum: { value: Number(sig.momentum ?? 0), evidence: "24h price move" },
    };
    const before = `[Modo Autopilot] Buying ${idea.symbol} at ${Math.round(conf * 100)}% confidence. ${idea.thesis}\n• News ${Number(sig.news ?? 0).toFixed(2)} · trader flow ${Number(sig.crowd ?? 0).toFixed(2)} · momentum ${Number(sig.momentum ?? 0).toFixed(2)} · your book ${Number(sig.own ?? 0).toFixed(2)}${idea.risk ? `\n• Risk: ${idea.risk}` : ""}`;
    const row = await one<{ id: string }>(
      `INSERT INTO auto_trades (user_id, asset_id, symbol, side, mode, status, signals, score, confidence, entry_price, explain_before, origin)
       VALUES ($1,$2,$3,'buy','real','open',$4,$5,$6,$7,$8,'modo') RETURNING id`, [userId, idea.asset_id, idea.symbol, JSON.stringify(signals), conf, conf, px, before]);
    try {
      const { order } = await place({ asset: { assetId: idea.asset_id }, side: "buy", orderType: "market", notionalUsd: Number(cfg.trade_usd), timeInForce: "gtc", accountId: account.id } as any,
        { userId, source: "auto", sourceRef: row!.id, idempotencyKey: `modo-auto:${row!.id}`, actor: { type: "system", id: "modo-autopilot" }, userConfirmed: account.kind === "paper" } as any);
      const ok = ["filled", "partially_filled", "submitted"].includes(order.status);
      const fill = Number(order.avg_fill_price) || null;
      const during = ok ? `Order ${order.status}${fill ? ` at ${money(fill)}` : ""} in your ${account.kind === "paper" ? "paper" : "live"} account. Exits at +${cfg.take_profit_pct}% / −${cfg.stop_loss_pct}%, 24h, or a Modo sell signal.`
        : order.status === "pending_approval" ? "Waiting for your approval (real-money automation needs approval)." : `Order ${order.status}: ${order.status_reason ?? "rejected by the risk checks"}.`;
      await q(`UPDATE auto_trades SET order_id=$2, explain_during=$3, entry_price=COALESCE($4, entry_price), status=CASE WHEN $5 OR $6 THEN 'open' ELSE 'failed' END WHERE id=$1`,
        [row!.id, order.id, during, fill, ok, order.status === "pending_approval"]);
      if (ok) bought++;
      thoughts.push({ text: `Bought ${idea.symbol}: ${during}`, kind: "idea", at: Date.now() });
      await publish(`user:${userId}`, "auto", { id: row!.id, phase: "before", symbol: idea.symbol, mode: "real", origin: "modo" });
    } catch (e: any) {
      await q("UPDATE auto_trades SET status='failed', explain_during=$2 WHERE id=$1", [row!.id, `Order failed: ${e.message}`]);
    }
  }
  if (!ideas.length) thoughts.push({ text: "No trade this round: the signals don't agree strongly enough.", kind: "think", at: Date.now() });
  // Keep a running history (last 200) so the activity feed shows earlier rounds too.
  thoughts.unshift({ text: `New round: scanned news, trader flow and momentum (${ideas.length} idea${ideas.length === 1 ? "" : "s"})`, kind: "round", at: thoughts[0]?.at ?? Date.now() });
  await q(`UPDATE auto_trading SET modo_thoughts = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(modo_thoughts || $2::jsonb) x OFFSET GREATEST(jsonb_array_length(modo_thoughts || $2::jsonb) - 200, 0)) t) WHERE user_id=$1`,
    [userId, JSON.stringify(thoughts)]);
  return { bought, sold, ideas: ideas.length };
}

/** Worker entry: Modo thinks every 3 minutes for each owner with Autopilot on (exits are checked on each pass). */
export async function runModoAutopilot() {
  const users = await q<{ user_id: string }>(
    `SELECT t.user_id FROM auto_trading t JOIN users u ON u.id=t.user_id AND u.role='super_admin'
      WHERE t.modo_autopilot AND (t.modo_last_run_at IS NULL OR t.modo_last_run_at < now() - interval '170 seconds')`);
  for (const u of users) { try { await runModoAutopilotFor(u.user_id); } catch (e: any) { console.error("[modo-autopilot]", e.message); } }
  return users.length;
}
