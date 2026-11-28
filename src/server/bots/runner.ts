import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { publish } from "../realtime";
import { getFlags } from "../flags";
import { place, notify } from "../engine/engine";
import { usdPx, getStrategy, type Decision, type Observation } from "./strategies";
import { heldForProfit } from "../engine/profit-guard";
/** Last status line per bot+coin (signature without numbers), so unchanged lines aren't re-logged every tick. */
const lastObs = new Map<string, { sig: string; at: number }>();

/**
 * Persistent bot runner (runs in the Railway worker, never in the browser).
 * Durable scheduling: bot state lives in Postgres; each tick claims a short lease so multiple
 * worker replicas never run the same bot concurrently, and restarts resume from saved state.
 * Duplicate-order prevention: every bot order uses a deterministic idempotency key
 * (bot id + strategy tag), so a crash mid-tick cannot double-submit.
 */
const INTERVAL_SEC: Record<string, number> = { every_15s: 15, every_1m: 60, every_5m: 300, every_15m: 900, every_1h: 3600 };

const botOwner = new Map<string, { userId: string; name: string; at: number }>();
export async function log(botId: string, level: string, message: string, data: unknown = {}) {
  await q("INSERT INTO bot_activity_logs (bot_id, level, message, data) VALUES ($1,$2,$3,$4)", [botId, level, message.slice(0, 1000), JSON.stringify(data)]);
  await publish(`bot:${botId}`, "log", { level, message, data, ts: Date.now() });
  // Also stream to the owner's channel so the live Activity page can show all of their bots at once.
  let owner = botOwner.get(botId);
  if (!owner || Date.now() - owner.at > 60_000) {
    const r = await one<{ user_id: string; name: string }>("SELECT user_id, name FROM trading_bots WHERE id=$1", [botId]);
    if (r) { owner = { userId: r.user_id, name: r.name, at: Date.now() }; botOwner.set(botId, owner); }
  }
  if (owner) await publish(`user:${owner.userId}`, "bot_log", { botId, botName: owner.name, level, message: message.slice(0, 300), ts: Date.now() });
}

export async function tickDueBots(workerId: string, max = 50) {
  const flags = await getFlags();
  if (flags.global_trading_halt) return 0;
  const bots = await q<any>(
    `UPDATE trading_bots SET lease_owner=$1, lease_expires_at=now() + interval '60 seconds'
      WHERE id IN (
        SELECT id FROM trading_bots
         WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at < now())
           AND (last_tick_at IS NULL OR last_tick_at < now() - make_interval(secs => CASE schedule
                 WHEN 'every_15s' THEN 15 WHEN 'every_5m' THEN 300 WHEN 'every_15m' THEN 900 WHEN 'every_1h' THEN 3600 ELSE 60 END))
         ORDER BY last_tick_at NULLS FIRST LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [workerId, max]);
  for (const b of bots) {
    try { await tickBot(b); }
    catch (e: any) {
      await log(b.id, "error", `Tick failed: ${e.message}`);
      await q("UPDATE trading_bots SET status='error' WHERE id=$1 AND status='running'", [b.id]);
      await notify(b.user_id, "bot", `Bot “${b.name}” stopped on error`, e.message, `/bots/${b.id}`);
    } finally {
      await q("UPDATE trading_bots SET last_tick_at=now(), lease_owner=NULL, lease_expires_at=NULL WHERE id=$1", [b.id]);
    }
  }
  return bots.length;
}

async function tickBot(b: any) {
  // daily counters reset
  if (new Date(b.day_anchor).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
    await q("UPDATE trading_bots SET spent_today_usd=0, trades_today=0, day_anchor=CURRENT_DATE WHERE id=$1", [b.id]);
    b.spent_today_usd = 0; b.trades_today = 0;
  }
  const risk = await one<any>("SELECT trading_halted FROM risk_settings WHERE user_id=$1", [b.user_id]);
  if (risk?.trading_halted) { await q("UPDATE trading_bots SET status='halted' WHERE id=$1", [b.id]); await log(b.id, "control", "Halted: user emergency stop engaged"); return; }

  const strat = getStrategy(b.strategy_id);
  if (!strat) throw new Error(`Unknown strategy ${b.strategy_id}`);

  if (b.strategy_id === "watchlist_monitor") return monitorWatchlist(b);
  if (b.strategy_id === "meme_discovery") return discoverMemes(b);
  if (b.strategy_id === "volume_liquidity_monitor") return monitorVolume(b);

  // Sync swing-loop state with actual order outcomes before deciding (reconciliation).
  let state = b.state ?? {};
  const multi = (b.asset_ids as string[]).length > 1;
  const swing = b.strategy_id === "dip_rebound_loop";
  const pending = (s: any) => s?.phase === "buy_pending" || s?.phase === "sell_pending";
  // Each coin in a multi-coin loop runs its own buy → sell → repeat cycle.
  if (swing && !multi && pending(state)) state = await reconcileSwing(b, state, false);
  if (swing && multi) for (const id of b.asset_ids as string[]) if (pending(state[id])) state = { ...state, [id]: await reconcileSwing(b, state[id], true) };

  for (const assetId of (b.asset_ids as string[]).slice(0, 1000)) {
    const a = await one<any>("SELECT * FROM assets WHERE id=$1", [assetId]);
    if (!a?.last_price) { await log(b.id, "warning", `No price for asset ${assetId}`); continue; }
    const age = (Date.now() - new Date(a.price_updated_at).getTime()) / 1000;
    if (age > 120) { await log(b.id, "warning", `Skipping ${a.symbol}: stale price (${Math.round(age)}s) — automated execution suspended until data recovers`); continue; }
    if (!b.is_paper && a.price_source === "simulated") { await log(b.id, "warning", `Skipping ${a.symbol}: simulated price cannot drive a live bot`); continue; }
    const pos = await one<any>("SELECT quantity, avg_cost FROM positions WHERE account_id=$1 AND asset_id=$2", [b.account_id, assetId]);
    const bars = b.strategy_id === "technical_indicator"
      ? (await q<any>("SELECT close, extract(epoch from ts)*1000 AS ts FROM price_bars WHERE asset_id=$1 AND timeframe='1h' ORDER BY ts DESC LIMIT 200", [assetId])).reverse()
      : undefined;
    const obs: Observation = { price: Number(a.last_price), ts: Date.now(), avgCost: pos?.avg_cost ? Number(pos.avg_cost) : undefined, positionQty: Number(pos?.quantity ?? 0), bars, source: a.price_source };
    const assetState = multi ? state[assetId] ?? {} : state;
    if (swing && assetState.phase === "done") continue;
    const { decision, state: next } = strat.decide(obs, assetState, b.params);
    const put = (s: any) => { state = multi ? { ...state, [assetId]: s } : s; };
    put(next);
    // Each line is about one coin: its symbol, live price and move (since the bot bought it, else over 24h) travel as data,
    // so the Activity feed can headline the coin instead of repeating the bot's name.
    const held = obs.positionQty > 0 && obs.avgCost ? obs.avgCost : null;
    const coin = { symbol: a.symbol, assetId, price: obs.price, source: a.price_source,
      move: held ? ((obs.price - held) / held) * 100 : a.change_24h != null ? Number(a.change_24h) : null, basis: held ? "since buy" : "24h" };
    // Status lines are written when they change (or every 10 minutes), not on every 5-second tick.
    const obsText = decision.action === "none" && decision.note ? decision.note : `${a.symbol} @ ${usdPx(obs.price)}`;
    const obsKey = `${b.id}:${assetId}`, prevObs = lastObs.get(obsKey);
    const sig = obsText.replace(/[\d.,$%]+/g, "#");
    if (!prevObs || prevObs.sig !== sig || Date.now() - prevObs.at > 600_000 || decision.action !== "none") {
      lastObs.set(obsKey, { sig, at: Date.now() });
      await log(b.id, "observation", obsText, { coin });
    }
    if (decision.action === "none") continue;
    if (decision.action === "complete") { await q("UPDATE trading_bots SET status='stopped' WHERE id=$1", [b.id]); await log(b.id, "control", `Completed: ${decision.reason}`); break; }
    if (decision.action === "alert") { await notify(b.user_id, "bot", `${b.name}: ${a.symbol}`, decision.message, `/bots/${b.id}`); continue; }
    if (decision.action === "sell") {
      const held = await heldForProfit(b.user_id, obs.price, obs.avgCost ?? assetState.entry ?? null, a.symbol);
      if (held) { put(assetState); await log(b.id, "observation", held, { coin }); continue; }
    }
    // A retry after a rejected order gets a fresh idempotency key (otherwise the old rejection is replayed forever).
    const res = await executeDecision(b, a, swing ? { ...decision, tag: `${decision.tag}:${next.fails ?? 0}` } : decision);
    if (swing) {
      if (res.ok && res.order) put({ ...next, pendingOrderId: res.order.id });
      else put({ ...next, phase: decision.action === "buy" ? "waiting_dip" : "holding", pendingOrderId: null, fails: (next.fails ?? 0) + 1 });
      await q("UPDATE trading_bots SET state=$2 WHERE id=$1", [b.id, JSON.stringify(state)]); // persist right away so a crash can't lose the pending order
    }
  }
  await q("UPDATE trading_bots SET state=$2, updated_at=now() WHERE id=$1", [b.id, JSON.stringify(state)]);
}

async function executeDecision(b: any, a: any, d: Exclude<Decision, { action: "none" | "complete" | "alert" }>) {
  await log(b.id, "trigger", `${d.action.toUpperCase()} ${a.symbol}: ${d.reason}`, { coin: { symbol: a.symbol, assetId: a.id, price: Number(a.last_price), source: a.price_source, move: a.change_24h != null ? Number(a.change_24h) : null, basis: "24h" } });
  // Bot-level limits (account-level limits are enforced again by the engine).
  if (b.max_trades_per_day != null && b.trades_today >= b.max_trades_per_day) { await log(b.id, "warning", `Max trades per day (${b.max_trades_per_day}) reached`); return { ok: false }; }
  // No bot budget, daily spend or daily loss caps (removed at the owner's request); the engine still checks real buying power.
  const cap = (x: unknown) => (Number(x) > 0 ? Number(x) : Infinity);
  const notional = d.action === "buy" ? (d.notionalUsd ?? (d.quantity ?? 0) * a.last_price) : 0;
  if (d.action === "buy" && notional <= 0) { await log(b.id, "warning", "No amount configured"); return { ok: false }; }
  const intent: any = d.action === "buy"
    ? { asset: { assetId: a.id }, side: "buy", orderType: "market", notionalUsd: Math.min(notional, cap(b.max_position_usd)), accountId: b.account_id, maxSlippageBps: b.max_slippage_bps, timeInForce: "gtc" }
    : { asset: { assetId: a.id }, side: "sell", orderType: "market", ...(d.quantity ? { quantity: d.quantity } : { percentOfPosition: d.percent ?? 100 }), accountId: b.account_id, maxSlippageBps: b.max_slippage_bps, timeInForce: "gtc" };
  await log(b.id, "instruction", "Validated instruction sent to Universal Trading Engine", intent);
  try {
    const { order } = await place(intent, {
      userId: b.user_id, source: "bot", sourceRef: b.id, idempotencyKey: `bot:${b.id}:${a.id}:${d.tag}`, actor: { type: "bot", id: b.id },
      botLimits: { approvalRequired: b.approval_required, maxSlippageBps: b.max_slippage_bps, minLiquidityUsd: Number(b.min_liquidity_usd), maxPositionUsd: Number(b.max_position_usd), allowRisky: !!b.allow_risky },
    });
    await q("UPDATE trading_bots SET trades_today=trades_today+1 WHERE id=$1", [b.id]);
    await log(b.id, order.status === "filled" ? "result" : "order", `Order ${order.status}${order.status_reason ? `: ${order.status_reason}` : ""}`, { orderId: order.id, qty: order.filled_quantity, price: order.avg_fill_price });
    // A cancelled or expired order (e.g. an old one handed back for the same key) is not a success: the bot retries with a fresh key.
    return { ok: !["rejected", "failed", "cancelled", "expired"].includes(order.status), order };
  } catch (e: any) {
    await log(b.id, "error", `Engine rejected instruction: ${e.message}`);
    return { ok: false };
  }
}

async function reconcileSwing(b: any, state: any, multi: boolean) {
  const id = state.pendingOrderId;
  if (!id) return { ...state, phase: state.phase === "buy_pending" ? "waiting_dip" : "holding" };
  const o = await one<any>("SELECT status, filled_quantity, avg_fill_price, side FROM orders WHERE id=$1", [id]);
  if (!o) return state;
  if (o.status === "filled") {
    if (o.side === "buy") {
      await log(b.id, "result", `Entry filled: ${o.filled_quantity} @ ${Number(o.avg_fill_price).toPrecision(6)}`);
      return { ...state, phase: "holding", entry: Number(o.avg_fill_price), qty: Number(o.filled_quantity), pendingOrderId: null, waitNote: undefined };
    }
    const cycles = (state.cycles ?? 0) + 1;
    const p = b.params;
    await log(b.id, "result", `Exit filled @ ${Number(o.avg_fill_price).toPrecision(6)} — cycle ${cycles} complete`);
    if (!p.repeat || (p.max_cycles && cycles >= p.max_cycles)) {
      await log(b.id, "control", p.repeat ? `Reached max cycles (${p.max_cycles})` : "Single cycle complete");
      if (multi) return { phase: "done", cycles, pendingOrderId: null }; // only this coin is finished
      await q("UPDATE trading_bots SET status='stopped' WHERE id=$1", [b.id]);
    }
    return { phase: "waiting_dip", ref: Number(o.avg_fill_price), cycles, pendingOrderId: null };
  }
  if (["rejected", "failed", "cancelled", "expired"].includes(o.status)) {
    await log(b.id, "warning", `Order ${o.status}; returning to previous phase`);
    return { ...state, phase: state.phase === "buy_pending" ? "waiting_dip" : "holding", pendingOrderId: null, waitNote: undefined, fails: (state.fails ?? 0) + 1 };
  }
  // Still open: say exactly why (needs your approval, or waiting at the broker/exchange) so the log isn't a bare "pending".
  const side = state.phase === "buy_pending" ? "Buy" : "Sell";
  const waitNote = o.status === "pending_approval" ? `${side} is waiting for YOUR approval (Portfolio → Orders, or turn off "Ask me before each trade" on this bot)`
    : `${side} sent, waiting for it to fill (${String(o.status).replace(/_/g, " ")})`;
  if (o.status === "pending_approval" && state.approvalNoted !== id) await log(b.id, "warning", waitNote);
  return { ...state, waitNote, approvalNoted: o.status === "pending_approval" ? id : state.approvalNoted };
}

async function monitorWatchlist(b: any) {
  const items = await q<any>(
    `SELECT a.id, a.symbol, a.last_price, a.change_24h, wi.target_price FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id JOIN assets a ON a.id=wi.asset_id WHERE w.user_id=$1`, [b.user_id]);
  const st = b.state ?? {};
  for (const it of items) {
    const tag = new Date().toISOString().slice(0, 13);
    if (Math.abs(it.change_24h ?? 0) >= (b.params.move_pct ?? 5) && st[`${it.id}:move`] !== tag.slice(0, 10)) {
      st[`${it.id}:move`] = tag.slice(0, 10);
      await notify(b.user_id, "alert", `${it.symbol} moved ${Number(it.change_24h).toFixed(2)}% today`, "", `/terminal/${it.id}`);
      await log(b.id, "trigger", `${it.symbol} 24h move ${Number(it.change_24h).toFixed(2)}%`);
    }
    if (it.target_price && it.last_price <= it.target_price && st[`${it.id}:target`] !== tag) {
      st[`${it.id}:target`] = tag;
      await notify(b.user_id, "alert", `${it.symbol} reached your target ${it.target_price}`, "", `/terminal/${it.id}`);
    }
  }
  await log(b.id, "observation", `Checked ${items.length} watchlist assets`);
  await q("UPDATE trading_bots SET state=$2 WHERE id=$1", [b.id, JSON.stringify(st)]);
}

async function discoverMemes(b: any) {
  const p = b.params;
  const seen: string[] = b.state?.seen ?? [];
  const rows = await q<any>(
    `SELECT * FROM assets WHERE asset_class='crypto' AND 'new' = ANY(categories) AND COALESCE(liquidity_usd,0) >= $1
       AND launched_at > now() - make_interval(mins => $2) AND ($3::text[] IS NULL OR venue = ANY($3)) ORDER BY launched_at DESC LIMIT 20`,
    [p.min_liquidity_usd ?? 50000, p.max_age_minutes ?? 120, b.markets?.length ? b.markets : null]);
  const fresh = rows.filter((r) => !seen.includes(r.id));
  for (const r of fresh) {
    await log(b.id, "trigger", `Candidate ${r.symbol} on ${r.venue}: liquidity $${Math.round(r.liquidity_usd).toLocaleString()}${r.risk_flags.includes("demo_data") ? " [DEMO DATA]" : ""}`, { assetId: r.id, flags: r.risk_flags });
    await notify(b.user_id, "bot", `New token match: ${r.symbol}`, `Liquidity $${Math.round(r.liquidity_usd).toLocaleString()}`, `/terminal/${r.id}`);
    if (p.auto_buy_usd > 0) await executeDecision(b, r, { action: "buy", notionalUsd: p.auto_buy_usd, reason: "Discovery rule matched", tag: `disc:${r.id}` });
  }
  if (!rows.length) await log(b.id, "observation", "No new tokens match the liquidity/age rules");
  await q("UPDATE trading_bots SET state=$2 WHERE id=$1", [b.id, JSON.stringify({ seen: [...seen, ...fresh.map((f) => f.id)].slice(-500) })]);
}

async function monitorVolume(b: any) {
  for (const id of b.asset_ids) {
    const a = await one<any>("SELECT symbol, volume_24h, liquidity_usd FROM assets WHERE id=$1", [id]);
    if (!a) continue;
    const prev = b.state?.[id]?.vol;
    if (prev && a.volume_24h && Math.abs((a.volume_24h - prev) / prev) * 100 >= (b.params.change_pct ?? 50))
      await notify(b.user_id, "bot", `${a.symbol} volume changed sharply`, `${Math.round(prev).toLocaleString()} → ${Math.round(a.volume_24h).toLocaleString()}`);
    b.state = { ...b.state, [id]: { vol: a.volume_24h } };
    await log(b.id, "observation", `${a.symbol} 24h volume $${Math.round(a.volume_24h ?? 0).toLocaleString()}`);
  }
  await q("UPDATE trading_bots SET state=$2 WHERE id=$1", [b.id, JSON.stringify(b.state ?? {})]);
}

/* ───────── Control ───────── */
export async function setBotStatus(userId: string, botId: string, action: "start" | "pause" | "resume" | "stop", actor: "user" | "ai" = "user") {
  const b = await one<any>("SELECT * FROM trading_bots WHERE id=$1 AND user_id=$2", [botId, userId]);
  if (!b) throw new Error("Bot not found");
  const next = action === "pause" ? "paused" : action === "stop" ? "stopped" : "running";
  if (next === "running") {
    const perms = await one<any>("SELECT allow_bots FROM trading_permissions WHERE user_id=$1", [userId]);
    if (!perms?.allow_bots) throw new Error("Bots are disabled in your automation permissions");
    if (!b.is_paper && !(await getFlags()).automated_real_money) throw new Error("Real-money bots are disabled until automated real-money trading is approved. Run this bot in paper mode.");
  }
  await q("UPDATE trading_bots SET status=$2, updated_at=now() WHERE id=$1", [botId, next]);
  await log(botId, "control", `${action} by ${actor}`);
  await audit({ actorType: actor, actorId: userId, userId, action: `bot.${action}`, target: botId });
}
export async function pauseAllBots(userId: string, actor: "user" | "ai" = "user") {
  const rows = await q<{ id: string }>("UPDATE trading_bots SET status='paused' WHERE user_id=$1 AND status='running' RETURNING id", [userId]);
  for (const r of rows) await log(r.id, "control", `Paused (pause all by ${actor})`);
  await audit({ actorType: actor, actorId: userId, userId, action: "bot.pause_all", data: { count: rows.length } });
  return rows.length;
}
export async function resumeAllBots(userId: string) {
  const rows = await q<{ id: string }>("UPDATE trading_bots SET status='running' WHERE user_id=$1 AND status='paused' AND is_paper RETURNING id", [userId]);
  await audit({ actorType: "user", actorId: userId, userId, action: "bot.resume_all", data: { count: rows.length } });
  return rows.length;
}
/** Emergency shutdown: stop all bots and engage the user's trading halt. */
export async function emergencyStop(userId: string) {
  await q("UPDATE trading_bots SET status='halted' WHERE user_id=$1 AND status IN ('running','paused')", [userId]);
  await q("UPDATE risk_settings SET trading_halted=true, updated_at=now() WHERE user_id=$1", [userId]);
  const { cancelAll } = await import("../engine/engine");
  const cancelled = await cancelAll(userId);
  await audit({ actorType: "user", actorId: userId, userId, action: "emergency_stop", data: { cancelled: cancelled.length } });
  await notify(userId, "system", "Emergency stop engaged", "All bots halted and open orders cancelled. Re-enable trading in Settings → Risk.");
  return { cancelled: cancelled.length };
}

/* ───────── Backtest ───────── */
export async function backtest(strategyId: string, assetId: string, params: any, opts: { timeframe?: "1h" | "1d"; feeBps?: number; slippageBps?: number; startCash?: number } = {}) {
  const strat = getStrategy(strategyId);
  if (!strat) throw new Error("Unknown strategy");
  const tf = opts.timeframe ?? "1h";
  const bars = await q<any>("SELECT close, extract(epoch from ts)*1000 AS ts, source FROM price_bars WHERE asset_id=$1 AND timeframe=$2 ORDER BY ts ASC", [assetId, tf]);
  if (bars.length < 30) throw new Error("Not enough historical bars to backtest");
  const fee = (opts.feeBps ?? 30) / 1e4, slip = (opts.slippageBps ?? 10) / 1e4;
  let cash = opts.startCash ?? 10_000, qty = 0, avg = 0, state: any = {}, peak = cash, maxDD = 0, wins = 0, losses = 0;
  const trades: any[] = [], equity: { ts: number; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const px = Number(bars[i].close), ts = Number(bars[i].ts);
    const { decision, state: next } = strat.decide({ price: px, ts, avgCost: qty ? avg : undefined, positionQty: qty, bars: bars.slice(Math.max(0, i - 200), i + 1).map((b: any) => ({ close: Number(b.close), ts: Number(b.ts) })), source: bars[i].source }, state, params);
    state = next;
    if (decision.action === "buy") {
      const n = Math.min(decision.notionalUsd ?? (decision.quantity ?? 0) * px, cash / (1 + fee));
      if (n > 1) { const fp = px * (1 + slip), q0 = n / fp; avg = (avg * qty + n) / (qty + q0); qty += q0; cash -= n * (1 + fee); trades.push({ ts, side: "buy", price: fp, qty: q0 }); }
      if (strategyId === "dip_rebound_loop") state = { ...state, phase: "holding", entry: px * (1 + slip), qty: qty };
    } else if (decision.action === "sell" && qty > 0) {
      const sq = decision.quantity ? Math.min(decision.quantity, qty) : qty * ((decision.percent ?? 100) / 100);
      const fp = px * (1 - slip), pnl = (fp - avg) * sq - fp * sq * fee;
      cash += fp * sq * (1 - fee); qty -= sq; pnl >= 0 ? wins++ : losses++;
      trades.push({ ts, side: "sell", price: fp, qty: sq, pnl });
      if (strategyId === "dip_rebound_loop") { const cycles = (state.cycles ?? 0) + 1; state = params.repeat && !(params.max_cycles && cycles >= params.max_cycles) ? { phase: "waiting_dip", ref: fp, cycles } : { phase: "done", cycles }; }
      if (qty < 1e-12) { qty = 0; avg = 0; }
    }
    const value = cash + qty * px;
    peak = Math.max(peak, value); maxDD = Math.max(maxDD, (peak - value) / peak);
    if (i % Math.max(1, Math.floor(bars.length / 300)) === 0) equity.push({ ts, value });
  }
  const end = cash + qty * Number(bars.at(-1).close), start = opts.startCash ?? 10_000;
  const simulatedData = bars.some((b: any) => b.source === "simulated");
  return {
    strategyId, assetId, timeframe: tf, bars: bars.length, startValue: start, endValue: end, returnPct: ((end - start) / start) * 100,
    buyHoldPct: ((Number(bars.at(-1).close) - Number(bars[0].close)) / Number(bars[0].close)) * 100,
    maxDrawdownPct: maxDD * 100, trades: trades.slice(-200), tradeCount: trades.length, winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
    equity, assumptions: { feeBps: opts.feeBps ?? 30, slippageBps: opts.slippageBps ?? 10 },
    dataWarning: simulatedData ? "Backtest used SIMULATED price history (no licensed historical data provider connected). Results are illustrative only." : null,
    disclaimer: "Past or simulated performance does not guarantee future results.",
  };
}
