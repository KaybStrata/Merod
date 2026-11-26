import "@/lib/server-only-shim";
import { one, q } from "../db";
import { getFlags } from "../flags";
import { place, preview } from "../engine/engine";
import { getNews } from "../news/service";
import { roleById, STRATEGY_LABEL } from "./catalog";
import { indicators, decide, backtestStrategy, type Bars, type Signal } from "./signals";
import { emit, positionsFor, metricsFor, postMessage, addKnowledge, remember, updateAgent, type EventKind } from "./service";

/**
 * AGENT WORKERS (Merod Parallel / Autopilot). Run in the durable worker, never in the browser, so agents keep working
 * with the browser closed. Each due agent is leased (FOR UPDATE SKIP LOCKED + lease expiry) so parallel workers never
 * run the same agent twice; a failure in one agent never stops the others (3 consecutive failures → failed).
 * Deterministic policy, in this order, before any order: global halt → user halt → fleet loss limit (risk_blocked) →
 * agent daily loss → stale data → autonomy level → capital budget → open-position cap → conflict detection →
 * Universal Trading Engine (permissions, risk, reservation, idempotency). Risk-reducing exits stay allowed when blocked.
 */
const MAX_ASSETS = 1000;
const STALE_SEC = { crypto: 180, stock: 900 };
const NOTE_EVERY_MS = 10 * 60_000;

async function bars(assetId: string, tf: string, n = 120): Promise<Bars> {
  const rows = (await q<any>("SELECT close, volume, high, low FROM price_bars WHERE asset_id=$1 AND timeframe=$2 ORDER BY ts DESC LIMIT $3", [assetId, tf === "15m" ? "15m" : tf === "1d" ? "1d" : "1h", n])).reverse();
  return { close: rows.map((r) => Number(r.close)), volume: rows.map((r) => Number(r.volume)), high: rows.map((r) => Number(r.high)), low: rows.map((r) => Number(r.low)) };
}

/** Emit only when the message changes or every 10 minutes per agent+topic (keeps the feed readable). */
async function note(a: any, topic: string, kind: EventKind, title: string, body: string, data: any = {}) {
  const st = a.state ?? {};
  const key = `${topic}`;
  const last = st.notes?.[key];
  const sig = `${title}|${body}`.slice(0, 300);
  if (last && last.sig === sig && Date.now() - last.t < NOTE_EVERY_MS * 3) return;
  if (last && Date.now() - last.t < NOTE_EVERY_MS && kind !== "decision" && kind !== "execution" && kind !== "warning" && last.sig.split("|")[0] === title) return;
  st.notes = { ...(st.notes ?? {}), [key]: { sig, t: Date.now() } };
  a.state = st;
  await emit(a.user_id, { agentId: a.id, fleetId: a.fleet_id, version: a.version, kind, title, body, data });
}
const room = (a: any) => (a.fleet_id ? `fleet:${a.fleet_id}` : "general");
const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}`;

/* ───────────────────────── Scheduler ───────────────────────── */
export async function runAgents(workerId: string, max = 40) {
  const flags = await getFlags();
  if (flags.global_trading_halt) return 0;
  // Promote queued → running (approved configurations only reach queued).
  const promoted = await q<any>("UPDATE agents SET status='running', updated_at=now() WHERE status='queued' RETURNING id, user_id, fleet_id, name, version");
  for (const p of promoted) await emit(p.user_id, { agentId: p.id, fleetId: p.fleet_id, version: p.version, kind: "state", title: `${p.name} is running`, body: "Paper worker started on the server." });
  const due = await q<any>(
    `UPDATE agents SET lease_owner=$1, lease_expires_at=now() + interval '90 seconds'
      WHERE id IN (SELECT id FROM agents WHERE status IN ('running','risk_blocked') AND (lease_expires_at IS NULL OR lease_expires_at < now())
                     AND (last_tick_at IS NULL OR last_tick_at < now() - make_interval(secs => GREATEST(15, COALESCE((schedule->>'everySec')::int, 60))))
                   ORDER BY last_tick_at NULLS FIRST LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [workerId, max]);
  await Promise.all(due.map(async (a) => {
    try {
      await tickAgent(a);
      await q("UPDATE agents SET fail_count=0 WHERE id=$1", [a.id]);
    } catch (e: any) {
      const fails = (a.fail_count ?? 0) + 1;
      await q("UPDATE agents SET fail_count=$2, status=CASE WHEN $2 >= 3 THEN 'failed' ELSE status END, stop_reason=CASE WHEN $2 >= 3 THEN $3 ELSE stop_reason END WHERE id=$1", [a.id, fails, `Watchdog: ${String(e.message).slice(0, 200)}`]);
      await emit(a.user_id, { agentId: a.id, fleetId: a.fleet_id, version: a.version, kind: "warning", title: fails >= 3 ? `${a.name} failed and was stopped by the watchdog` : `${a.name} hit an error (${fails}/3)`, body: String(e.message).slice(0, 500) });
    } finally {
      await q("UPDATE agents SET last_tick_at=now(), lease_owner=NULL, lease_expires_at=NULL, state=$2, metrics=$3 WHERE id=$1", [a.id, JSON.stringify(a.state ?? {}), JSON.stringify(a.metrics ?? {})]);
    }
  }));
  return due.length;
}

/** Equity snapshots for every active agent (cards, drawdown, arena). */
export async function snapshotAgents() {
  const agents = await q<any>("SELECT * FROM agents WHERE status IN ('running','paused','risk_blocked','queued','completed') AND capital_usd > 0");
  for (const a of agents) {
    const m = await metricsFor(a);
    await q("INSERT INTO agent_snapshots (agent_id, equity_usd, invested_usd) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [a.id, m.capital + m.pnl, m.invested]);
  }
  await q("DELETE FROM agent_snapshots WHERE ts < now() - interval '120 days'");
  await q("UPDATE agent_competitions SET status='completed' WHERE status='running' AND ends_at < now()");
  return agents.length;
}

/* ───────────────────────── One agent tick ───────────────────────── */
export async function tickAgent(a: any) {
  a.state = a.state ?? {}; a.metrics = a.metrics ?? {};
  await deliverScheduledPrompts(a);
  const halt = await one<any>("SELECT trading_halted FROM risk_settings WHERE user_id=$1", [a.user_id]);
  if (halt?.trading_halted) {
    await q("UPDATE agents SET status='paused', stop_reason='Account emergency stop is on' WHERE id=$1", [a.id]);
    await emit(a.user_id, { agentId: a.id, fleetId: a.fleet_id, kind: "state", title: `${a.name} paused: account emergency stop is on` });
    return;
  }
  if (a.fleet_id) {
    const f = await one<any>("SELECT status FROM agent_fleets WHERE id=$1", [a.fleet_id]);
    if (f?.status === "risk_blocked" && a.status !== "risk_blocked") { a.status = "risk_blocked"; await q("UPDATE agents SET status='risk_blocked', stop_reason='Fleet daily loss limit reached' WHERE id=$1", [a.id]); }
  }
  if (!(await conditionMet(a))) return;
  const role = roleById(a.role);
  if (!role) throw new Error(`Unknown role ${a.role}`);
  switch (a.role) {
    case "stock_trading": case "crypto_trading": case "memecoin": case "sniping": case "execution": return tradeTick(a);
    case "mimic": case "copy_trading": return mimicTick(a);
    case "exit": return exitTick(a);
    case "market_scanner": return scanTick(a);
    case "technical_analysis": return technicalTick(a);
    case "news": case "earnings": case "macro": return newsTick(a);
    case "social_sentiment": return sentimentTick(a);
    case "wallet_tracking": return walletTick(a);
    case "fundamental_analysis": return fundamentalTick(a);
    case "arbitrage": return arbitrageTick(a);
    case "risk_management": case "supervisor": return supervisorTick(a);
    case "portfolio": return portfolioTick(a);
    case "backtesting": return backtestTick(a);
    case "auto_training": return trainingTick(a);
    case "counterargument": return counterTick(a);
    case "strategy_builder": return strategyBuilderTick(a);
    case "agent_builder": return agentBuilderTick(a);
  }
}

async function deliverScheduledPrompts(a: any) {
  const prompts: any[] = a.schedule?.prompts ?? [];
  const due = prompts.filter((p) => !p.delivered && new Date(p.at).getTime() <= Date.now());
  if (!due.length) return;
  const text = `${a.instructions}\n${due.map((p) => `[${new Date(p.at).toISOString().slice(0, 16)}] ${p.text}`).join("\n")}`.slice(0, 4000);
  const next = prompts.map((p) => (due.includes(p) ? { ...p, delivered: true } : p));
  await updateAgent(a.user_id, a.id, { instructions: text, schedule: { ...a.schedule, prompts: next }, note: "Scheduled prompt delivered" }, { by: "schedule" });
  a.instructions = text; a.schedule = { ...a.schedule, prompts: next };
}

/** Conditional activation: run only while the market condition holds. */
async function conditionMet(a: any) {
  const c = a.schedule?.kind === "condition" ? a.schedule.condition : null;
  if (!c) return true;
  const as = await one<any>("SELECT symbol, last_price, change_24h FROM assets WHERE upper(symbol)=upper($1) AND last_price IS NOT NULL ORDER BY market_cap DESC NULLS LAST LIMIT 1", [c.symbol]);
  if (!as) { await note(a, "cond", "warning", `Condition asset ${c.symbol} not found`, "Agent is idle until the condition can be checked."); return false; }
  const px = Number(as.last_price), ch = Number(as.change_24h ?? 0);
  const ok = c.op === "above" ? px > c.value : c.op === "below" ? px < c.value : c.op === "change_up" ? ch >= c.value : ch <= -Math.abs(c.value);
  await note(a, "cond", "thought", ok ? `Activated: ${c.symbol} condition met` : `Standing by: ${c.symbol} condition not met`, `${c.symbol} ${fmt(px)} (24h ${ch.toFixed(2)}%) vs ${c.op.replace("_", " ")} ${c.value}`);
  return ok;
}

/* ───────────────────────── Policy checks ───────────────────────── */
async function blockedForNewRisk(a: any): Promise<string | null> {
  if (a.status === "risk_blocked") return "risk-blocked by the fleet loss limit";
  if (a.mode !== "paper") return "live execution is locked";
  const lossCap = Number(a.risk?.dailyLossUsd ?? 0);
  if (lossCap > 0) {
    const m = await metricsFor(a);
    if (m.pnl24h <= -lossCap) {
      await q("UPDATE agents SET status='risk_blocked', stop_reason=$2 WHERE id=$1", [a.id, `Daily loss ${fmt(-m.pnl24h)} reached the ${fmt(lossCap)} limit`]);
      a.status = "risk_blocked";
      await emit(a.user_id, { agentId: a.id, fleetId: a.fleet_id, kind: "warning", title: `${a.name}: daily loss limit reached`, body: `New risk-increasing orders blocked (loss ${fmt(-m.pnl24h)} ≥ ${fmt(lossCap)}). Exits still allowed.` });
      return "agent daily loss limit reached";
    }
  }
  return null;
}
/** Agent Conflict Detection: another agent of this user is working the opposite side of the same asset. */
async function conflict(a: any, assetId: string, side: "buy" | "sell") {
  const other = await one<any>(
    `SELECT ag.name FROM orders o JOIN agents ag ON ag.id::text=o.source_ref
      WHERE o.user_id=$1 AND o.source='agent' AND o.source_ref <> $2 AND o.asset_id=$3 AND o.side <> $4
        AND (o.status IN ('pending_approval','validated','submitted','partially_filled','unknown') OR o.updated_at > now() - interval '10 minutes') LIMIT 1`,
    [a.user_id, a.id, assetId, side]);
  return other?.name ?? null;
}

async function submit(a: any, asset: any, side: "buy" | "sell", sig: Signal, opts: { notional?: number; qty?: number; ind?: any; riskReducing?: boolean; corr: string }) {
  const level = a.autonomy_level as number;
  const label = `${side === "buy" ? "Buy" : "Sell"} ${asset.symbol}`;
  const sizeTxt = opts.notional ? fmt(opts.notional) : `${opts.qty?.toPrecision(6)} ${asset.symbol}`;
  const policy = a.fleet_id ? (await one<any>("SELECT shared_policy, operation_mode FROM agent_fleets WHERE id=$1", [a.fleet_id])) : null;
  if (level <= 2) {
    await note(a, `sig:${asset.id}:${side}`, "decision", `${level === 1 ? "Observed" : "Suggests"}: ${label}`, `${sig.reason}. ${level === 1 ? "Observe mode: recorded only." : "Suggest mode: no order created."}`, { signal: sig, inputs: opts.ind, assetId: asset.id });
    return;
  }
  const other = !opts.riskReducing ? await conflict(a, asset.id, side) : null;
  if (other) {
    const pol = policy?.shared_policy?.conflict ?? "reject";
    await note(a, `conf:${asset.id}`, "warning", `Conflict: ${other} is ${side === "buy" ? "selling" : "buying"} ${asset.symbol}`, `Policy "${pol}": this ${side} was ${pol === "queue" ? "queued for the next run" : "rejected"}. Independent positions are never netted automatically.`);
    return;
  }
  // Collaborative / sequential fleets: research → validation → supervisor chain is posted to the agent room.
  if (policy && ["collaborative", "sequential", "supervisor"].includes(policy.operation_mode) && !opts.riskReducing) {
    await postMessage(a.user_id, { room: room(a), fleetId: a.fleet_id, senderAgentId: a.id, senderLabel: a.name, msgType: "proposal", body: `${label} ${sizeTxt}: ${sig.reason}`, correlationId: opts.corr, refs: sig.checks });
    await postMessage(a.user_id, { room: room(a), fleetId: a.fleet_id, senderLabel: "Risk service", msgType: "validation", body: `Within allocation ${fmt(Number(a.capital_usd))} and exposure limits; the order engine re-checks permissions, price freshness and buying power.`, correlationId: opts.corr, depth: 1 });
  }
  const intent: any = { asset: { assetId: asset.id }, side, orderType: "market", timeInForce: "gtc", ...(opts.qty ? { quantity: opts.qty } : { notionalUsd: opts.notional }) };
  if (level === 3) {
    const p = await preview(intent, { userId: a.user_id, source: "agent", sourceRef: a.id, idempotencyKey: `preview:${opts.corr}`, actor: { type: "ai", id: a.id } });
    await note(a, `prep:${asset.id}:${side}`, "decision", `Prepared order preview: ${label} ${sizeTxt}`, `${sig.reason}. Preview ${p.decision === "rejected" ? `would be rejected: ${p.decisionReason}` : `passes ${p.checks.filter((c) => c.ok).length}/${p.checks.length} checks`}. Prepare mode: not submitted.`, { signal: sig, checks: p.checks, inputs: opts.ind });
    return;
  }
  const bucket = Math.floor(Date.now() / (Math.max(15, Number(a.schedule?.everySec ?? 60)) * 1000));
  const r: any = await place(intent, {
    userId: a.user_id, source: "agent", sourceRef: a.id, idempotencyKey: `agent:${a.id}:${asset.id}:${side}:${bucket}`, actor: { type: "ai", id: a.id },
    botLimits: { approvalRequired: level === 4, maxSlippageBps: 100, minLiquidityUsd: 0, maxPositionUsd: Number(a.risk?.maxPositionUsd ?? a.capital_usd ?? 0) || 1e9 },
  });
  const o = r.order;
  if (r.replayed) return;
  const kind: EventKind = o.status === "pending_approval" ? "approval" : o.status === "rejected" ? "warning" : "execution";
  const filled = Number(o.filled_quantity ?? 0) > 0;
  const title = o.status === "pending_approval" ? `Approval needed: ${label} ${sizeTxt}` : o.status === "rejected" ? `${label} rejected by the order engine` : filled ? `${side === "buy" ? "Buy" : "Sell"} order filled: ${Number(o.filled_quantity).toPrecision(6)} ${asset.symbol} @ ${fmt(Number(o.avg_fill_price))}` : `${label} submitted (${o.status})`;
  await emit(a.user_id, { agentId: a.id, fleetId: a.fleet_id, version: a.version, kind, title, body: `${sig.reason}${o.status_reason ? `. ${o.status_reason}` : ""}`, data: { orderId: o.id, status: o.status, signal: sig, inputs: opts.ind, assetId: asset.id, price: o.avg_fill_price ?? asset.last_price, side }, correlationId: opts.corr });
  if (side === "buy" && o.status !== "rejected") {
    const entry = Number(o.avg_fill_price ?? asset.last_price);
    const tp = Number(a.strategy?.takeProfitPct ?? 0), sl = Number(a.strategy?.stopLossPct ?? 0);
    a.state.exits = { ...(a.state.exits ?? {}), [asset.id]: { tp: tp ? entry * (1 + tp / 100) : null, sl: sl ? entry * (1 - sl / 100) : null } };
    if (a.strategy?.kind === "dip") a.state.ref = { ...(a.state.ref ?? {}), [asset.id]: null };
  }
  if (side === "sell" && o.status !== "rejected") {
    const ex = { ...(a.state.exits ?? {}) }; delete ex[asset.id]; a.state.exits = ex;
    if (filled && Number(o.realized_pnl) < 0) await remember(a.id, "lessons", `Loss on ${asset.symbol}: ${sig.reason}`);
  }
  if (policy && ["collaborative", "sequential", "supervisor"].includes(policy.operation_mode) && !opts.riskReducing)
    await postMessage(a.user_id, { room: room(a), fleetId: a.fleet_id, senderLabel: "Supervisor", msgType: "validation", body: o.status === "pending_approval" ? "Validation complete. Order preview ready for user approval." : o.status === "rejected" ? `Order rejected: ${o.status_reason}` : "Validation complete. Order routed to the paper engine.", correlationId: opts.corr, depth: 2 });
}

/* ───────────────────────── Trading roles ───────────────────────── */
async function universe(a: any): Promise<any[]> {
  let ids: string[] = a.asset_ids ?? [];
  const scan = a.universe?.scan;
  if (!ids.length && (scan || a.role === "memecoin" || a.role === "sniping")) {
    const meme = scan?.meme ?? a.role === "memecoin";
    const rows = await q<any>(
      `SELECT id FROM assets WHERE NOT ('demo_data'=ANY(risk_flags)) AND last_price IS NOT NULL AND price_source IS NOT NULL AND price_source <> 'simulated'
         AND ($1::text IS NULL OR asset_class=$1) AND (NOT $2 OR EXISTS (SELECT 1 FROM unnest(categories) c WHERE c ILIKE '%meme%'))
         AND ($3 = false OR launched_at > now() - interval '3 days')
       ORDER BY volume_24h DESC NULLS LAST LIMIT $4`, [scan?.assetClass ?? (meme || a.role === "sniping" ? "crypto" : null), meme, a.role === "sniping", Math.min(MAX_ASSETS, scan?.limit ?? 8)]);
    ids = rows.map((r) => r.id);
  }
  if (!ids.length) return [];
  return q<any>("SELECT * FROM assets WHERE id = ANY($1) LIMIT $2", [ids.slice(0, MAX_ASSETS), MAX_ASSETS]);
}
function staleSec(asset: any) { return asset.price_updated_at ? (Date.now() - new Date(asset.price_updated_at).getTime()) / 1000 : Infinity; }

async function tradeTick(a: any) {
  const assets = await universe(a);
  if (!assets.length) { await note(a, "idle", "warning", "No assets to trade", "Add assets to this agent (or a scan filter) so it has something to work on."); return; }
  const blocked = await blockedForNewRisk(a);
  const positions = await positionsFor(a.id);
  const strat = a.strategy ?? { kind: "momentum" };
  let budget = Number(a.capital_usd) - positions.reduce((s, p) => s + p.cost, 0);
  for (const asset of assets) {
    const corr = `${a.id.slice(0, 8)}-${asset.symbol}-${Date.now()}`;
    const age = staleSec(asset), limit = asset.asset_class === "crypto" ? STALE_SEC.crypto : STALE_SEC.stock;
    const pos = positions.find((p) => p.assetId === asset.id);
    if (!asset.last_price || age > limit || asset.price_source === "simulated") {
      await note(a, `stale:${asset.id}`, "warning", `${asset.symbol}: data stale, new orders paused`, asset.asset_class === "crypto" ? (!asset.last_price || !Number.isFinite(age) ? "No live price received yet: waiting for the price feed." : `Last real price ${age < 120 ? `${Math.round(age)}s` : age < 7200 ? `${Math.round(age / 60)} min` : `${Math.round(age / 3600)}h`} old.`) :"Market closed or quotes delayed; waiting for fresh prices.");
      continue;
    }
    const b = await bars(asset.id, strat.timeframe ?? "1h");
    const ind = indicators(b, Number(asset.last_price));
    // Exits first (risk-reducing; allowed even when blocked).
    const ex = a.state.exits?.[asset.id];
    if (pos && ex && ((ex.tp && ind.price >= ex.tp) || (ex.sl && ind.price <= ex.sl))) {
      const hitTp = ex.tp && ind.price >= ex.tp;
      await submit(a, asset, "sell", { action: "sell", confidence: 1, reason: hitTp ? `Take-profit ${fmt(ex.tp)} reached at ${fmt(ind.price)}` : `Stop-loss ${fmt(ex.sl)} hit at ${fmt(ind.price)}`, checks: [] }, { qty: pos.qty, ind, riskReducing: true, corr });
      continue;
    }
    if (strat.kind === "dip" && !pos) { const ref = a.state.ref?.[asset.id]; if (!ref || ind.price > ref) a.state.ref = { ...(a.state.ref ?? {}), [asset.id]: Math.max(ref ?? 0, ind.price) }; }
    const sig = decide(strat, ind, { holding: !!pos, ref: a.state.ref?.[asset.id] ?? null, lastBuyAt: pos?.lastBuyAt ? new Date(pos.lastBuyAt).getTime() : (a.state.lastBuy?.[asset.id] ?? null) });
    await note(a, `ana:${asset.id}`, "analysis", `${asset.symbol} ${fmt(ind.price)} · ${sig.action === "hold" ? "watching" : sig.action}`, `${sig.checks.join(" · ")}. ${sig.reason}.`, { inputs: ind, signal: sig, assetId: asset.id });
    if (sig.action === "buy") {
      if (blocked) { await note(a, `blk:${asset.id}`, "warning", `Buy ${asset.symbol} blocked`, `New risk-increasing orders are blocked: ${blocked}.`); continue; }
      if (positions.length >= Number(strat.maxOpen ?? 3)) { await note(a, "maxopen", "thought", `Max open positions (${strat.maxOpen}) reached`, `Skipping ${asset.symbol} entry.`); continue; }
      const size = Math.min(Number(strat.tradeUsd ?? 100), Number(a.risk?.maxOrderUsd ?? Infinity), budget);
      if (size < 1) { await note(a, "budget", "thought", "Allocated capital fully invested", `No budget left for ${asset.symbol} (capital ${fmt(Number(a.capital_usd))}).`); continue; }
      await note(a, `th:${asset.id}`, "thought", `${asset.symbol} setup detected`, `${sig.reason}. Confidence ${(sig.confidence * 100).toFixed(0)}%.`, { signal: sig });
      await submit(a, asset, "buy", sig, { notional: Math.round(size * 100) / 100, ind, corr });
      budget -= size;
      a.state.lastBuy = { ...(a.state.lastBuy ?? {}), [asset.id]: Date.now() };
    } else if (sig.action === "sell" && pos) {
      await submit(a, asset, "sell", sig, { qty: pos.qty, ind, riskReducing: true, corr });
    }
  }
}

/** Mimic / copy agents mirror trades seen by your watch-mode wallet/trader follows (public data), within the agent's budget. */
async function mimicTick(a: any) {
  const wallets: string[] = a.universe?.wallets ?? [];
  const since = a.state.mimicSince ? new Date(a.state.mimicSince) : new Date(Date.now() - 10 * 60_000);
  const events = await q<any>(
    `SELECT e.*, f.wallet_address, f.label FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id
      WHERE f.follower_id=$1 AND e.created_at > $2 AND (cardinality($3::text[]) = 0 OR f.wallet_address = ANY($3)) AND e.asset_id IS NOT NULL
      ORDER BY e.created_at LIMIT 20`, [a.user_id, since, wallets]);
  a.state.mimicSince = new Date().toISOString();
  if (!events.length) { await note(a, "mimic", "thought", "Watching followed wallets", wallets.length ? `${wallets.length} wallet(s); no new trades since last check.` : "No wallets set: watching all your followed wallets/traders. Add wallets to narrow it."); return; }
  const blocked = await blockedForNewRisk(a);
  const positions = await positionsFor(a.id);
  let budget = Number(a.capital_usd) - positions.reduce((s, p) => s + p.cost, 0);
  for (const e of events) {
    const asset = await one<any>("SELECT * FROM assets WHERE id=$1", [e.asset_id]);
    if (!asset?.last_price) continue;
    const corr = `${a.id.slice(0, 8)}-mimic-${e.id}`;
    const sig: Signal = { action: e.side, confidence: 0.7, reason: `${e.label ?? "Followed wallet"} ${e.side === "buy" ? "bought" : "sold"} ${asset.symbol} (${e.venue})`, checks: [] };
    if (e.side === "buy") {
      if (blocked) { await note(a, `blk:${asset.id}`, "warning", `Mimic buy ${asset.symbol} blocked`, blocked); continue; }
      const size = Math.min(Number(a.strategy?.tradeUsd ?? 50), budget);
      if (size < 1) { await note(a, "budget", "thought", "Mimic budget used", "Allocated capital fully invested."); continue; }
      await submit(a, asset, "buy", sig, { notional: Math.round(size * 100) / 100, corr }); budget -= size;
    } else {
      const pos = positions.find((p) => p.assetId === asset.id);
      if (pos) await submit(a, asset, "sell", sig, { qty: pos.qty, riskReducing: true, corr });
    }
  }
}

/** Exit agent: enforces take-profit / stop-loss for every trading agent in its fleet (risk-reducing only). */
async function exitTick(a: any) {
  const siblings = a.fleet_id ? await q<any>("SELECT * FROM agents WHERE fleet_id=$1 AND id <> $2 AND status <> 'archived'", [a.fleet_id, a.id]) : [a];
  let managed = 0;
  for (const s of siblings) {
    for (const p of await positionsFor(s.id)) {
      managed++;
      if (p.price == null) continue;
      const tp = p.takeProfit ?? (s.strategy?.takeProfitPct ? p.entry * (1 + s.strategy.takeProfitPct / 100) : null);
      const sl = p.stopLoss ?? (s.strategy?.stopLossPct ? p.entry * (1 - s.strategy.stopLossPct / 100) : null);
      if ((tp && p.price >= tp) || (sl && p.price <= sl)) {
        const asset = await one<any>("SELECT * FROM assets WHERE id=$1", [p.assetId]);
        const sig: Signal = { action: "sell", confidence: 1, reason: `${s.name}'s ${p.symbol} ${tp && p.price >= tp ? `take-profit ${fmt(tp)}` : `stop-loss ${fmt(sl!)}`} reached at ${fmt(p.price)}`, checks: [] };
        if (a.autonomy_level < 4) { await note(a, `exit:${p.assetId}`, "decision", `Exit suggested: ${p.symbol}`, sig.reason); continue; }
        await submit({ ...s, autonomy_level: Math.min(s.autonomy_level, a.autonomy_level), state: s.state ?? {} }, asset, "sell", sig, { qty: p.qty, riskReducing: true, corr: `exit-${p.assetId}-${Date.now()}` });
      }
    }
  }
  await note(a, "exits", "thought", `Managing exits for ${managed} position${managed === 1 ? "" : "s"}`, "Take-profit and stop-loss levels checked on live prices.");
}

/* ───────────────────────── Research roles (read-only) ───────────────────────── */
async function scanTick(a: any) {
  const min = Number(a.universe?.scan?.minChangePct ?? 5);
  const assets = a.asset_ids?.length ? await q<any>("SELECT * FROM assets WHERE id = ANY($1)", [a.asset_ids]) : await q<any>(
    `SELECT * FROM assets WHERE NOT ('demo_data'=ANY(risk_flags)) AND last_price IS NOT NULL AND price_source IS NOT NULL AND price_source <> 'simulated' AND price_updated_at > now() - interval '1 hour'
       AND ($1::text IS NULL OR asset_class=$1) AND (NOT $2 OR EXISTS (SELECT 1 FROM unnest(categories) c WHERE c ILIKE '%meme%'))
     ORDER BY volume_24h DESC NULLS LAST LIMIT 150`, [a.universe?.scan?.assetClass ?? null, !!a.universe?.scan?.meme]);
  const signals = assets.filter((x) => Math.abs(Number(x.change_24h ?? 0)) >= min / 2);
  const qualified = assets.filter((x) => Number(x.change_24h ?? 0) >= min && Number(x.liquidity_usd ?? x.volume_24h ?? 0) > 50_000 && !(x.risk_flags ?? []).some((f: string) => ["honeypot", "high_tax", "freeze_authority"].includes(f)));
  const prev: string[] = a.state.qualified ?? [];
  const fresh = qualified.filter((x) => !prev.includes(x.id));
  a.state.qualified = qualified.map((x) => x.id);
  a.metrics = { ...a.metrics, signals: signals.length, qualified: qualified.length, fresh: fresh.length, opportunities: qualified.length, scanned: assets.length, top: qualified.slice(0, 8).map((x) => ({ symbol: x.symbol, change: Number(x.change_24h) })) };
  await note(a, "scan", "analysis", `${qualified.length} opportunit${qualified.length === 1 ? "y" : "ies"} · ${signals.length} signals`, `Scanned ${assets.length} assets for 24h ≥ ${min}% with liquidity. ${qualified.slice(0, 5).map((x) => `${x.symbol} +${Number(x.change_24h).toFixed(1)}%`).join(", ") || "None qualified."}`);
  for (const x of fresh.slice(0, 3)) {
    await postMessage(a.user_id, { room: room(a), fleetId: a.fleet_id, senderAgentId: a.id, senderLabel: a.name, msgType: "finding", body: `${x.symbol} +${Number(x.change_24h).toFixed(2)}% (24h) with volume ${fmt(Number(x.volume_24h ?? 0))}. Sending for analysis.`, refs: [{ assetId: x.id }] });
    await addKnowledge(a.user_id, { fleetId: a.fleet_id, agentId: a.id, topic: `Scanner: ${x.symbol}`, body: `${x.symbol} qualified at ${fmt(Number(x.last_price))} (+${Number(x.change_24h).toFixed(2)}% 24h).`, source: x.price_source });
  }
}

async function technicalTick(a: any) {
  const assets = await universe(a);
  for (const asset of assets.slice(0, 6)) {
    const ind = indicators(await bars(asset.id, a.strategy?.timeframe ?? "1h"), asset.last_price ? Number(asset.last_price) : undefined);
    if (ind.bars < 15) { await note(a, `ta:${asset.id}`, "warning", `${asset.symbol}: not enough history yet`, `${ind.bars} bars available.`); continue; }
    const trend = (ind.ema12 ?? 0) > (ind.ema26 ?? 0) ? "bullish" : "bearish";
    const body = `RSI ${ind.rsi14?.toFixed(0)} · MACD ${(ind.macd ?? 0) >= 0 ? "positive" : "negative"} · trend ${trend} · SMA20 ${ind.sma20 ? fmt(ind.sma20) : "n/a"} · 20-bar range ${ind.low20 ? fmt(ind.low20) : "?"}–${ind.high20 ? fmt(ind.high20) : "?"}${ind.volumeRise ? ` · volume ×${ind.volumeRise.toFixed(2)}` : ""}`;
    await note(a, `ta:${asset.id}`, "analysis", `${asset.symbol} ${fmt(ind.price)}: ${trend}`, body, { inputs: ind });
    if (a.fleet_id) await postMessage(a.user_id, { room: room(a), fleetId: a.fleet_id, senderAgentId: a.id, senderLabel: a.name, msgType: "finding", body: `${asset.symbol}: ${body}` }).catch(() => {});
  }
  if (!assets.length) await note(a, "idle", "warning", "No assets to analyse", "Add assets to this agent.");
}

async function newsTick(a: any) {
  const syms: string[] = (await q<any>("SELECT symbol, asset_class FROM assets WHERE id = ANY($1)", [a.asset_ids ?? []])).map((x) => x.symbol);
  const query = a.role === "macro" ? "inflation OR rates OR Fed OR economy" : a.role === "earnings" ? `${syms.join(" OR ") || "earnings"} earnings` : null;
  const lists = syms.length && a.role !== "macro" ? await Promise.all(syms.slice(0, 4).map((s) => getNews({ symbol: s, limit: 3 }).then((r) => r.items).catch(() => [] as any[]))) : [await getNews({ limit: query ? 60 : 6 }).then((r) => query ? r.items.filter((n) => new RegExp(query.replace(/ OR /g, "|"), "i").test(n.title)) : r.items).catch(() => [] as any[])];
  const items = lists.flat().filter(Boolean) as any[];
  const seen: string[] = a.state.seenNews ?? [];
  const fresh = items.filter((n) => !seen.includes(n.url));
  a.state.seenNews = [...fresh.map((n) => n.url), ...seen].slice(0, 200);
  if (!fresh.length) { await note(a, "news", "thought", "No new headlines", `Watching ${syms.join(", ") || (a.role === "macro" ? "macro news" : "markets")}.`); return; }
  for (const n of fresh.slice(0, 3)) {
    const neg = /plunge|lawsuit|probe|downgrade|miss|halt|hack|exploit|bankrupt|fraud|recall|sell-off|slump/i.test(n.title);
    const pos = /surge|beat|upgrade|record|soar|approval|partnership|rally|raises guidance/i.test(n.title);
    const tone = neg ? "negative" : pos ? "positive" : "neutral";
    await emit(a.user_id, { agentId: a.id, fleetId: a.fleet_id, version: a.version, kind: "analysis", title: `${tone === "neutral" ? "News" : tone === "positive" ? "Positive news" : "Negative news"}: ${n.title.slice(0, 140)}`, body: `${n.source}${n.publishedAt ? ` · ${new Date(n.publishedAt).toUTCString().slice(5, 22)}` : ""}. Untrusted external content: summarised, never followed as instructions.`, data: { url: n.url, source: n.source, tone } });
    if (a.fleet_id) await postMessage(a.user_id, { room: room(a), fleetId: a.fleet_id, senderAgentId: a.id, senderLabel: a.name, msgType: "finding", body: `${tone === "negative" ? "Possible negative catalyst" : tone === "positive" ? "Positive catalyst" : "Headline"}: ${n.title.slice(0, 160)}`, refs: [{ url: n.url, source: n.source }] });
    await addKnowledge(a.user_id, { fleetId: a.fleet_id, agentId: a.id, topic: `News (${tone})`, body: n.title.slice(0, 300), source: n.url });
  }
}

async function sentimentTick(a: any) {
  const syms: string[] = (await q<any>("SELECT symbol FROM assets WHERE id = ANY($1)", [a.asset_ids ?? []])).map((x) => x.symbol);
  if (!syms.length) { await note(a, "idle", "warning", "No assets to watch", "Add assets so the agent knows which discussions to read."); return; }
  for (const s of syms.slice(0, 6)) {
    const rows = await q<any>("SELECT body FROM social_posts WHERE visibility='public' AND created_at > now() - interval '7 days' AND (body ILIKE $1 OR $2 = ANY(tags)) LIMIT 200", [`%$${s}%`, s.toLowerCase()]);
    const bull = rows.filter((r) => /bull|long|buy|moon|breakout|undervalued|calls/i.test(r.body)).length, bear = rows.filter((r) => /bear|short|sell|dump|overvalued|puts|rug/i.test(r.body)).length;
    const score = rows.length ? Math.round(((bull - bear) / Math.max(1, bull + bear)) * 50 + 50) : null;
    await note(a, `soc:${s}`, "analysis", `${s} sentiment ${score == null ? "n/a" : `${score}/100`}`, rows.length ? `${rows.length} public Merod posts in 7 days: ${bull} bullish, ${bear} bearish. Source: Merod Social only (other networks not connected).` : "No public Merod posts mention it this week. Other social networks aren't connected.");
  }
}

async function walletTick(a: any) {
  const wallets: string[] = a.universe?.wallets ?? [];
  if (!wallets.length) { await note(a, "idle", "warning", "No wallets to track", "Add public Solana wallet addresses to this agent (Edit → Wallets)."); return; }
  const rows = await q<any>(
    `SELECT f.wallet_address, count(e.*)::int AS trades, count(*) FILTER (WHERE e.side='buy')::int AS buys, max(e.created_at) AS last, array_agg(DISTINCT e.symbol) FILTER (WHERE e.symbol IS NOT NULL) AS syms
       FROM copy_follows f LEFT JOIN copy_trade_events e ON e.follow_id=f.id AND e.created_at > now() - interval '7 days'
      WHERE f.follower_id=$1 AND f.wallet_address = ANY($2) GROUP BY f.wallet_address`, [a.user_id, wallets]);
  const tracked = new Set(rows.map((r) => r.wallet_address));
  const untracked = wallets.filter((w) => !tracked.has(w));
  for (const r of rows) await note(a, `w:${r.wallet_address}`, "analysis", `Wallet ${r.wallet_address.slice(0, 4)}…${r.wallet_address.slice(-4)}: ${r.trades} trades in 7d`, `${r.buys} buys, ${r.trades - r.buys} sells${r.syms?.length ? ` · ${r.syms.slice(0, 6).join(", ")}` : ""}${r.trades >= 5 ? ". Active enough to review as a mimic candidate." : ""}`);
  if (untracked.length) await note(a, "untracked", "thought", `${untracked.length} wallet(s) not followed yet`, "Turn on Watch or Mimic for these wallets in Mimic trading so their public swaps are recorded (needs a Helius key).", { wallets: untracked });
}

async function fundamentalTick(a: any) {
  const assets = await q<any>("SELECT * FROM assets WHERE id = ANY($1)", [a.asset_ids ?? []]);
  if (!assets.length) { await note(a, "idle", "warning", "No assets to study", "Add stocks to this agent."); return; }
  for (const x of assets.slice(0, 6)) await note(a, `f:${x.id}`, "analysis", `${x.symbol} snapshot`, `Price ${x.last_price ? fmt(Number(x.last_price)) : "n/a"} · market cap ${x.market_cap ? fmt(Number(x.market_cap)) : "n/a"} · 24h volume ${x.volume_24h ? fmt(Number(x.volume_24h)) : "n/a"}. Earnings statements and valuation ratios need a fundamentals data provider (not connected).`);
}

async function arbitrageTick(a: any) {
  const syms: string[] = (await q<any>("SELECT DISTINCT upper(symbol) AS s FROM assets WHERE id = ANY($1)", [a.asset_ids ?? []])).map((x) => x.s);
  const list = syms.length ? syms : ["BTC", "ETH", "SOL"];
  for (const s of list.slice(0, 6)) {
    const rows = await q<any>("SELECT venue, last_price, price_source FROM assets WHERE upper(symbol)=$1 AND last_price IS NOT NULL AND price_updated_at > now() - interval '10 minutes' AND price_source <> 'simulated' AND NOT ('demo_data'=ANY(risk_flags))", [s]);
    if (rows.length < 2) { await note(a, `arb:${s}`, "thought", `${s}: one fresh venue only`, "Need two fresh venue prices to compare."); continue; }
    const px = rows.map((r) => Number(r.last_price)); const lo = Math.min(...px), hi = Math.max(...px);
    const spread = ((hi - lo) / lo) * 100, net = spread - 0.6; // ~0.3% fees each side
    await note(a, `arb:${s}`, "analysis", `${s} spread ${spread.toFixed(2)}% (${net > 0 ? `≈${net.toFixed(2)}% after fees` : "not profitable after fees"})`, `${rows.length} venues: ${rows.map((r) => `${r.venue} ${fmt(Number(r.last_price))}`).join(", ")}. Report only: transfer times, liquidity and slippage make this no guaranteed profit.`);
  }
}

/** Supervisor / Risk Management: deterministic fleet loss limit, concentration and stale-data monitor. */
async function supervisorTick(a: any) {
  const fleet = a.fleet_id ? await one<any>("SELECT * FROM agent_fleets WHERE id=$1", [a.fleet_id]) : null;
  const members = fleet ? await q<any>("SELECT * FROM agents WHERE fleet_id=$1 AND id <> $2 AND status <> 'archived'", [fleet.id, a.id]) : await q<any>("SELECT * FROM agents WHERE user_id=$1 AND id <> $2 AND status IN ('running','risk_blocked','paused')", [a.user_id, a.id]);
  const ms = await Promise.all(members.map(async (m) => ({ m, x: await metricsFor(m) })));
  const capital = fleet ? Math.max(Number(fleet.capital_usd), ms.reduce((s, r) => s + r.x.capital, 0)) : ms.reduce((s, r) => s + r.x.capital, 0);
  const day = ms.reduce((s, r) => s + r.x.pnl24h, 0);
  const lossPct = capital > 0 ? (-day / capital) * 100 : 0;
  const limit = Number(fleet?.daily_loss_pct ?? a.risk?.dailyLossPct ?? 2);
  // Concentration across agents
  const byAsset = new Map<string, number>(); let invested = 0;
  for (const { m } of ms) for (const p of await positionsFor(m.id)) { byAsset.set(p.symbol, (byAsset.get(p.symbol) ?? 0) + p.value); invested += p.value; }
  const top = [...byAsset.entries()].sort((x, y) => y[1] - x[1])[0];
  const conc = top && invested > 0 ? (top[1] / invested) * 100 : 0;
  const failed = ms.filter((r) => r.m.status === "failed").map((r) => r.m.name);
  a.metrics = { ...a.metrics, portfolioRiskPct: capital > 0 ? +((invested / capital) * 100).toFixed(1) : 0, maxDrawdownPct: +Math.max(0, lossPct).toFixed(2), dailyLimitPct: limit, concentrationPct: +conc.toFixed(1), withinLimits: lossPct < limit };
  if (fleet && lossPct >= limit && fleet.status === "running") {
    await q("UPDATE agent_fleets SET status='risk_blocked', risk_blocked_at=now(), stop_reason=$2 WHERE id=$1", [fleet.id, `Combined daily loss ${lossPct.toFixed(2)}% ≥ ${limit}%`]);
    await q("UPDATE agents SET status='risk_blocked', stop_reason='Fleet daily loss limit reached' WHERE fleet_id=$1 AND status IN ('running','queued')", [fleet.id]);
    await emit(a.user_id, { agentId: a.id, fleetId: fleet.id, kind: "warning", title: `Loss limit reached: new orders stopped for "${fleet.name}"`, body: `Combined daily P&L ${fmt(day)} (${lossPct.toFixed(2)}% of ${fmt(capital)}) reached the ${limit}% limit. New risk-increasing orders are blocked; exits still run. Losses can exceed the limit because of gaps and slippage.` });
    await postMessage(a.user_id, { room: room(a), fleetId: fleet.id, senderAgentId: a.id, senderLabel: a.name, msgType: "escalation", body: `Requesting pause: combined daily loss ${lossPct.toFixed(2)}% ≥ ${limit}%. New orders blocked; you can review and re-enable on the fleet page.` });
    return;
  }
  const warn = conc > 60 && byAsset.size > 0 ? ` · ${top![0]} is ${conc.toFixed(0)}% of invested capital` : "";
  await note(a, "risk", lossPct >= limit * 0.75 || conc > 60 || failed.length ? "warning" : "analysis", lossPct < limit ? "Within limits" : "Limit reached",
    `${members.length} agents · daily P&L ${day < 0 ? "−" : "+"}${fmt(Math.abs(day))} (${lossPct > 0 ? `down ${lossPct.toFixed(2)}%` : `up ${Math.abs(lossPct).toFixed(2)}%`}; pauses at a ${limit}% daily loss) · invested ${fmt(invested)}${warn}${failed.length ? ` · failed: ${failed.join(", ")}` : ""}`);
}

async function portfolioTick(a: any) {
  const rows = await q<any>("SELECT p.quantity, a.symbol, a.last_price FROM positions p JOIN assets a ON a.id=p.asset_id JOIN trading_accounts t ON t.id=p.account_id WHERE p.user_id=$1 AND t.kind='paper' AND p.quantity > 0", [a.user_id]);
  const vals = rows.map((r) => ({ s: r.symbol, v: Number(r.quantity) * Number(r.last_price ?? 0) })).sort((x, y) => y.v - x.v);
  const tot = vals.reduce((s, x) => s + x.v, 0);
  if (!tot) { await note(a, "pf", "thought", "No holdings yet", "Nothing to rebalance."); return; }
  const top = vals[0], w = (top.v / tot) * 100;
  await note(a, "pf", w > 40 ? "warning" : "analysis", `${vals.length} holdings · ${fmt(tot)}`, `Largest: ${top.s} ${w.toFixed(0)}%${w > 40 ? " (concentrated, consider rebalancing)" : ""}. ${vals.slice(0, 5).map((x) => `${x.s} ${((x.v / tot) * 100).toFixed(0)}%`).join(", ")}.`);
}

async function targetsFor(a: any) {
  return a.fleet_id ? q<any>("SELECT * FROM agents WHERE fleet_id=$1 AND id <> $2 AND status <> 'archived'", [a.fleet_id, a.id]) : q<any>("SELECT * FROM agents WHERE user_id=$1 AND id <> $2 AND status IN ('running','paused')", [a.user_id, a.id]);
}

async function backtestTick(a: any) {
  if (a.state.lastBacktest && Date.now() - a.state.lastBacktest < 6 * 3600_000) return;
  a.state.lastBacktest = Date.now();
  for (const t of (await targetsFor(a)).filter((t) => roleById(t.role)?.trades && t.asset_ids?.length).slice(0, 6)) {
    const asset = await one<any>("SELECT id, symbol FROM assets WHERE id=$1", [t.asset_ids[0]]);
    const b = await bars(asset.id, "1h", 2000);
    if (b.close.length < 60) { await note(a, `bt:${t.id}`, "warning", `${t.name}: not enough history to backtest`, `${b.close.length} hourly bars of ${asset.symbol}.`); continue; }
    const r = backtestStrategy(t.strategy, b);
    await note(a, `bt:${t.id}`, "analysis", `Backtest ${t.name} on ${asset.symbol}: ${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(2)}%`, `${r.bars} real hourly bars · ${r.trades} trades · win rate ${r.winRate?.toFixed(0) ?? "n/a"}% · max drawdown ${r.maxDrawdownPct.toFixed(1)}% · Sharpe ${r.sharpe?.toFixed(2) ?? "n/a"} (fees ${r.assumptions.feeBps}bps, slippage ${r.assumptions.slippageBps}bps). Backtested, not live results.`, { result: r });
  }
}

/** Auto-training: evaluate each target's closed trades after costs and propose a versioned change (never auto-applied to live). */
export async function proposeImprovement(userId: string, t: any) {
  const closes = await q<any>("SELECT realized_pnl, fees_usd FROM orders WHERE source='agent' AND source_ref=$1 AND side='sell' AND filled_quantity > 0 ORDER BY updated_at DESC LIMIT 50", [t.id]);
  const losses = closes.filter((c) => Number(c.realized_pnl) < 0).length, wins = closes.length - losses;
  const net = closes.reduce((s, c) => s + Number(c.realized_pnl), 0);
  const s = t.strategy ?? {};
  const proposed: any = { ...s };
  const why: string[] = [];
  if (closes.length >= 3 && losses > wins) {
    if (s.kind === "momentum" || s.kind === "news") { proposed.minChangePct = +(Number(s.minChangePct ?? 1.5) * 1.5).toFixed(2); why.push("More losers than winners: require a stronger 24h move before entering"); }
    if (s.kind === "mean_reversion") { proposed.rsiBuy = Math.max(10, Number(s.rsiBuy ?? 30) - 5); why.push("Entries were early: buy only at deeper oversold RSI"); }
    if (s.kind === "breakout") { proposed.minVolumeRise = +(Number(s.minVolumeRise ?? 1.3) + 0.3).toFixed(2); why.push("False breakouts: require more volume confirmation"); }
    if (Number(s.stopLossPct ?? 0) > 0) { proposed.stopLossPct = +(Number(s.stopLossPct) * 0.8).toFixed(2); why.push("Cut losses sooner"); }
  } else if (closes.length >= 3 && wins > losses * 2 && Number(s.takeProfitPct ?? 0) > 0) { proposed.takeProfitPct = +(Number(s.takeProfitPct) * 1.25).toFixed(2); why.push("Winners were cut early: let profits run further"); }
  else if (closes.length < 3) { why.push(`Only ${closes.length} closed trades: compare a tighter variant on history`); proposed.stopLossPct = Math.max(0.5, +(Number(s.stopLossPct ?? 2) * 0.75).toFixed(2)); }
  if (JSON.stringify(proposed) === JSON.stringify(s)) return null;
  const asset = t.asset_ids?.[0] ? await one<any>("SELECT id, symbol FROM assets WHERE id=$1", [t.asset_ids[0]]) : null;
  let evidence: any = { closedTrades: closes.length, wins, losses, netPnl: net, note: "No history available for a backtest" };
  if (asset) {
    const b = await bars(asset.id, "1h", 2000);
    if (b.close.length >= 60) {
      const cut = Math.floor(b.close.length * 0.7);
      const slice = (x: Bars, from: number, to?: number): Bars => ({ close: x.close.slice(from, to), volume: x.volume.slice(from, to), high: x.high.slice(from, to), low: x.low.slice(from, to) });
      evidence = { ...evidence, asset: asset.symbol, bars: b.close.length, note: "In-sample = first 70% of real hourly history, out-of-sample = last 30%. Backtested results, not live.",
        current: { inSample: backtestStrategy(s, slice(b, 0, cut)), outOfSample: backtestStrategy(s, slice(b, Math.max(0, cut - 30))) },
        candidate: { inSample: backtestStrategy(proposed, slice(b, 0, cut)), outOfSample: backtestStrategy(proposed, slice(b, Math.max(0, cut - 30))) } };
      const better = evidence.candidate.outOfSample.returnPct > evidence.current.outOfSample.returnPct;
      evidence.verdict = better ? "Candidate beats the current version out-of-sample" : "Candidate does not beat the current version out-of-sample: overfitting risk";
    }
  }
  await q("UPDATE agent_training_candidates SET status='superseded' WHERE agent_id=$1 AND status='proposed'", [t.id]);
  const c = await one<any>("INSERT INTO agent_training_candidates (agent_id, user_id, base_version, diagnosis, proposed, evidence) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [t.id, userId, t.version, JSON.stringify({ reasons: why, wins, losses, netPnl: net }), JSON.stringify(proposed), JSON.stringify(evidence)]);
  await emit(userId, { agentId: t.id, fleetId: t.fleet_id, version: t.version, kind: "training", title: `Improvement proposed for ${t.name}`, body: `${why.join("; ")}. ${evidence.verdict ?? ""} Review it on Auto-Training: nothing changes until you approve.`, data: { candidateId: c.id } });
  return c;
}
async function trainingTick(a: any) {
  if (a.state.lastTraining && Date.now() - a.state.lastTraining < 12 * 3600_000) return;
  a.state.lastTraining = Date.now();
  let n = 0;
  for (const t of (await targetsFor(a)).filter((t) => roleById(t.role)?.trades && !t.locked_strategy).slice(0, 8)) if (await proposeImprovement(a.user_id, t)) n++;
  await note(a, "train", "training", `Reviewed agents: ${n} improvement${n === 1 ? "" : "s"} proposed`, "Learning = evaluating decisions and proposing versioned configuration changes. The AI model itself is not retrained.");
}

async function counterTick(a: any) {
  const props = await q<any>("SELECT * FROM agent_messages WHERE user_id=$1 AND msg_type='proposal' AND created_at > now() - interval '15 minutes' AND ($2::uuid IS NULL OR fleet_id=$2) ORDER BY id DESC LIMIT 5", [a.user_id, a.fleet_id]);
  const done: number[] = a.state.countered ?? [];
  for (const p of props.filter((x) => !done.includes(Number(x.id)))) {
    const sym = (p.body.match(/(?:Buy|Sell) ([A-Z0-9.]+)/) ?? [])[1];
    const asset = sym ? await one<any>("SELECT * FROM assets WHERE upper(symbol)=$1 AND last_price IS NOT NULL ORDER BY market_cap DESC NULLS LAST LIMIT 1", [sym]) : null;
    const risks: string[] = [];
    if (asset) {
      const ind = indicators(await bars(asset.id, "1h"), Number(asset.last_price));
      if ((ind.rsi14 ?? 50) > 65) risks.push(`RSI ${ind.rsi14?.toFixed(0)} is stretched`);
      if ((ind.change24hPct ?? 0) > 8) risks.push(`already +${ind.change24hPct?.toFixed(1)}% in 24h (chasing risk)`);
      if ((ind.volumeRise ?? 1) < 1) risks.push("volume isn't confirming");
      if ((asset.categories ?? []).some((c: string) => /meme/i.test(c))) risks.push("meme coin: can drop most of its value quickly");
      if ((asset.risk_flags ?? []).length) risks.push(`risk flags: ${asset.risk_flags.join(", ")}`);
    }
    if (!risks.length) risks.push("no strong counter-signal; main risk is a market-wide reversal");
    await postMessage(a.user_id, { room: p.room, fleetId: p.fleet_id, senderAgentId: a.id, senderLabel: a.name, msgType: "counterargument", body: `Bear case on "${p.body.slice(0, 60)}": ${risks.join("; ")}.`, correlationId: p.correlation_id, depth: (p.depth ?? 0) + 1 });
    done.push(Number(p.id));
  }
  a.state.countered = done.slice(-100);
  if (!props.length) await note(a, "ctr", "thought", "No proposals to challenge", "Waiting for trading agents to propose entries.");
}

async function strategyBuilderTick(a: any) {
  if (a.state.compiledFor === a.version) return;
  const { compile } = await import("../lab/strategies");
  const r = await compile({ text: a.instructions });
  a.state.compiledFor = a.version;
  await note(a, "sb", r.ok ? "analysis" : "warning", r.ok ? "Instructions compiled to strategy rules" : "Instructions need more detail", r.ok ? `${r.summary}. Save it from Strategies → Builder to version and backtest it.` : [...r.errors, ...r.missing].join("; "), { compiled: r.draft });
}

async function agentBuilderTick(a: any) {
  if (a.state.lastBuild && Date.now() - a.state.lastBuild < 6 * 3600_000) return;
  a.state.lastBuild = Date.now();
  const movers = await q<any>(
    `SELECT symbol, change_24h, asset_class FROM assets WHERE NOT ('demo_data'=ANY(risk_flags)) AND last_price IS NOT NULL AND price_source <> 'simulated' AND price_updated_at > now() - interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM agents g WHERE g.user_id=$1 AND g.status <> 'archived' AND assets.id = ANY(g.asset_ids))
      ORDER BY abs(change_24h) DESC NULLS LAST LIMIT 3`, [a.user_id]);
  for (const m of movers) await postMessage(a.user_id, { room: room(a), fleetId: a.fleet_id, senderAgentId: a.id, senderLabel: a.name, msgType: "proposal", body: `Proposed specialist: "${m.symbol} ${STRATEGY_LABEL.momentum}" (${m.asset_class === "crypto" ? "Crypto" : "Stock"} Trading, paper, observe first). ${m.symbol} moved ${Number(m.change_24h).toFixed(1)}% in 24h. Create it from Agents → New agent if you approve.` });
  await note(a, "ab", "decision", `Proposed ${movers.length} specialist agent${movers.length === 1 ? "" : "s"}`, `${movers.map((m) => m.symbol).join(", ") || "No uncovered movers"}. Proposals only: agents are never created without your approval.`);
}

/** Agent Replay: re-run the current rules on the inputs recorded in a past decision. */
export async function replayEvent(userId: string, eventId: number) {
  const e = await one<any>("SELECT e.*, a.strategy, a.version AS current_version FROM agent_events e JOIN agents a ON a.id=e.agent_id WHERE e.id=$1 AND e.user_id=$2", [eventId, userId]);
  if (!e) return null;
  const ind = e.data?.inputs;
  if (!ind) return { event: e, replay: null, note: "This event has no recorded market inputs to replay." };
  const holding = e.data?.side === "sell";
  const now = decide(e.strategy, ind, { holding });
  return { event: e, recorded: e.data?.signal ?? null, replay: now, sameDecision: (e.data?.signal?.action ?? null) === now.action, recordedVersion: e.version, currentVersion: e.current_version };
}
