import "@/lib/server-only-shim";
import { z } from "zod";
import { one, q, tx } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { publish } from "../realtime";
import { cancel, place } from "../engine/engine";
import { ROLES, ROLE_IDS, roleById, defaultStrategy, routeModel, type StrategyKind } from "./catalog";

/**
 * MEROD AGENTS — persistent, versioned, owner-scoped agents and fleets (Prompted Multi-Agent spec §01–§09, §18).
 * Agents analyse, plan and propose; deterministic services (this policy layer + the Universal Trading Engine) validate
 * permissions, capital, risk, market data and orders. Paper only: live mode is refused here and can never be switched
 * on from a prompt. Research-only roles never receive capital. No agent can raise its own autonomy, capital or limits:
 * only user-authenticated API calls reach update/act.
 */
export type AgentStatus = "draft" | "configured" | "pending_approval" | "queued" | "running" | "paused" | "risk_blocked" | "failed" | "completed" | "archived";
export type AgentAction = "approve" | "start" | "pause" | "resume" | "stop" | "archive" | "cancel_orders" | "close_positions" | "fork" | "reject";
const LIVE_LOCK = "Live agents are locked: agents run in paper mode until live execution is separately authorised, verified and safety-tested.";

/* ───────────────────────── Validation ───────────────────────── */
export const StrategySchema = z.object({
  kind: z.enum(["momentum", "mean_reversion", "breakout", "dip", "dca", "news", "mimic", "none"]),
  tradeUsd: z.number().positive().max(1_000_000).default(100),
  takeProfitPct: z.number().min(0).max(500).default(4),
  stopLossPct: z.number().min(0).max(95).default(2),
  maxOpen: z.number().int().min(1).max(100000).default(3),
  timeframe: z.enum(["15m", "1h", "1d"]).default("1h"),
  minChangePct: z.number().min(0).max(100).optional(),
  rsiMax: z.number().min(1).max(100).optional(),
  rsiBuy: z.number().min(1).max(99).optional(),
  rsiSell: z.number().min(1).max(99).optional(),
  lookback: z.number().int().min(5).max(200).optional(),
  minVolumeRise: z.number().min(0).max(20).optional(),
  dipPct: z.number().min(0.1).max(90).optional(),
  everyHours: z.number().min(1).max(24 * 30).optional(),
}).strict();
export const RiskSchema = z.object({
  maxOrderUsd: z.number().positive().max(10_000_000).optional(),
  maxPositionUsd: z.number().positive().max(10_000_000).optional(),
  dailyLossUsd: z.number().positive().max(10_000_000).optional(),
  allowRiskyTokens: z.boolean().optional(),
}).strict();
export const ScheduleSchema = z.object({
  kind: z.enum(["continuous", "interval", "condition"]).default("continuous"),
  everySec: z.number().int().min(15).max(86_400).default(60),
  condition: z.object({ symbol: z.string().max(24), op: z.enum(["above", "below", "change_up", "change_down"]), value: z.number() }).optional(),
  prompts: z.array(z.object({ at: z.string().datetime(), text: z.string().min(1).max(2000), delivered: z.boolean().default(false) })).max(20).optional(),
}).strict();
export const AgentInput = z.object({
  name: z.string().min(1).max(60),
  role: z.enum(ROLE_IDS),
  instructions: z.string().max(4000).default(""),
  assets: z.array(z.string().min(1).max(120)).max(1000).default([]),
  wallets: z.array(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Not a Solana address")).max(1000).default([]),
  scan: z.object({ assetClass: z.enum(["stock", "crypto"]).nullable().optional(), meme: z.boolean().optional(), minChangePct: z.number().optional(), limit: z.number().int().min(1).max(1000).optional() }).optional(),
  strategy: StrategySchema.partial().optional(),
  model: z.string().max(40).default("auto"),
  autonomy: z.number().int().min(1).max(6).optional(),
  capitalUsd: z.number().min(0).max(100_000_000).default(0),
  risk: RiskSchema.default({}),
  schedule: ScheduleSchema.partial().optional(),
  mode: z.enum(["paper", "live"]).default("paper"),
  toolPolicy: z.object({ shareKnowledge: z.boolean().optional(), canMessage: z.array(z.string()).optional() }).strict().optional(),
});
export type AgentInputT = z.input<typeof AgentInput>;
export const AgentPatch = z.object({
  name: z.string().min(1).max(60).optional(),
  instructions: z.string().max(4000).optional(),
  assets: z.array(z.string().min(1).max(120)).max(1000).optional(),
  wallets: z.array(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)).max(1000).optional(),
  strategy: StrategySchema.partial().optional(),
  model: z.string().max(40).optional(),
  autonomy: z.number().int().min(1).max(6).optional(),
  capitalUsd: z.number().min(0).max(100_000_000).optional(),
  risk: RiskSchema.optional(),
  schedule: ScheduleSchema.partial().optional(),
  lockedStrategy: z.boolean().optional(),
  pinned: z.boolean().optional(),
  mode: z.enum(["paper", "live"]).optional(),
  note: z.string().max(300).optional(),
}).strict();
export type AgentPatchT = z.infer<typeof AgentPatch>;

/* ───────────────────────── Events (black box + live activity) ───────────────────────── */
export type EventKind = "thought" | "analysis" | "decision" | "execution" | "warning" | "approval" | "state" | "message" | "training" | "system";
export async function emit(userId: string, e: { agentId?: string | null; fleetId?: string | null; version?: number | null; kind: EventKind; title: string; body?: string; data?: unknown; correlationId?: string | null }) {
  const row = await one<any>(
    `INSERT INTO agent_events (user_id, agent_id, fleet_id, version, kind, title, body, data, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId, e.agentId ?? null, e.fleetId ?? null, e.version ?? null, e.kind, e.title.slice(0, 200), (e.body ?? "").slice(0, 4000), JSON.stringify(e.data ?? {}), e.correlationId ?? null]);
  if (e.agentId) await q("UPDATE agents SET last_event_at=now() WHERE id=$1", [e.agentId]);
  await publish(`user:${userId}`, "agent", row).catch(() => {});
  return row;
}

/* ───────────────────────── Assets ───────────────────────── */
/** Resolve symbols / ids / mint addresses to assets (dominant real listing per symbol). */
export async function resolveAssetRefs(refs: string[]) {
  const ids: string[] = [], unresolved: string[] = [], symbols: string[] = [];
  for (const raw of refs) {
    const r = raw.trim();
    if (!r) continue;
    const a = /^[0-9a-f-]{36}$/i.test(r)
      ? await one<any>("SELECT id, symbol FROM assets WHERE id=$1", [r])
      : await one<any>(
        `SELECT id, symbol FROM assets WHERE (upper(symbol)=upper($1) OR identifier=$1) AND NOT ('demo_data'=ANY(risk_flags))
          ORDER BY (identifier=$1) DESC, (last_price IS NOT NULL) DESC, market_cap DESC NULLS LAST LIMIT 1`, [r.replace(/^\$/, "")]);
    if (a && !ids.includes(a.id)) { ids.push(a.id); symbols.push(a.symbol); } else if (!a) unresolved.push(r);
  }
  return { ids, symbols, unresolved };
}

/* ───────────────────────── Capital (spec §08) ───────────────────────── */
async function paperAccount(userId: string, c?: any) {
  const a = await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper' AND status='active' ORDER BY created_at LIMIT 1", [userId], c);
  if (!a) throw new HttpError(400, "No paper account found");
  return a;
}
/** Net open position per asset for an agent, from its own filled orders (plus handoff adjustments). */
export async function positionsFor(agentId: string, c?: any) {
  const rows = await q<any>(
    `SELECT o.asset_id, a.symbol, a.last_price, a.logo_url, a.asset_class,
            SUM(CASE WHEN o.side='buy' THEN o.filled_quantity ELSE -o.filled_quantity END) AS qty,
            SUM(CASE WHEN o.side='buy' THEN o.filled_quantity*o.avg_fill_price ELSE 0 END) AS buy_cost,
            SUM(CASE WHEN o.side='buy' THEN o.filled_quantity ELSE 0 END) AS buy_qty,
            MAX(o.updated_at) FILTER (WHERE o.side='buy') AS last_buy_at
       FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.source='agent' AND o.source_ref=$1 AND o.filled_quantity > 0
      GROUP BY o.asset_id, a.symbol, a.last_price, a.logo_url, a.asset_class`, [agentId], c);
  const agent = await one<any>("SELECT state FROM agents WHERE id=$1", [agentId], c);
  const adj: Record<string, { qty: number; cost: number; symbol?: string }> = agent?.state?.adjust ?? {};
  const map = new Map<string, any>();
  for (const r of rows) {
    const qty = Number(r.qty), entry = Number(r.buy_qty) > 0 ? Number(r.buy_cost) / Number(r.buy_qty) : 0;
    map.set(r.asset_id, { assetId: r.asset_id, symbol: r.symbol, logo: r.logo_url, assetClass: r.asset_class, qty, entry, price: r.last_price != null ? Number(r.last_price) : null, lastBuyAt: r.last_buy_at });
  }
  for (const [assetId, a] of Object.entries(adj)) {
    const m = map.get(assetId);
    if (m) { const tq = m.qty + a.qty; m.entry = tq > 0 ? (m.entry * m.qty + a.cost) / tq : m.entry; m.qty = tq; }
    else if (a.qty) {
      const as = await one<any>("SELECT symbol, last_price, logo_url, asset_class FROM assets WHERE id=$1", [assetId], c);
      map.set(assetId, { assetId, symbol: as?.symbol ?? a.symbol, logo: as?.logo_url, assetClass: as?.asset_class, qty: a.qty, entry: a.qty ? a.cost / a.qty : 0, price: as?.last_price != null ? Number(as.last_price) : null, lastBuyAt: null });
    }
  }
  const exits = agent?.state?.exits ?? {};
  return [...map.values()].filter((p) => p.qty > 1e-12).map((p) => ({
    ...p, cost: p.qty * p.entry, value: p.price != null ? p.qty * p.price : p.qty * p.entry,
    pnl: p.price != null ? (p.price - p.entry) * p.qty : 0, pnlPct: p.entry && p.price != null ? ((p.price - p.entry) / p.entry) * 100 : 0,
    takeProfit: exits[p.assetId]?.tp ?? null, stopLoss: exits[p.assetId]?.sl ?? null,
  }));
}
export async function investedBy(agentId: string, c?: any) { return (await positionsFor(agentId, c)).reduce((s, p) => s + p.cost, 0); }

/** Account-level capital view: available, allocated to agents, invested by agents, reserved by open orders. */
export async function capitalSummary(userId: string) {
  const acct = await paperAccount(userId);
  const agents = await q<any>("SELECT id, name, role, capital_usd, status, fleet_id FROM agents WHERE user_id=$1 AND status <> 'archived'", [userId]);
  let invested = 0; const per: any[] = [];
  for (const a of agents) { const inv = await investedBy(a.id); invested += inv; per.push({ id: a.id, name: a.name, role: a.role, status: a.status, capital: Number(a.capital_usd), invested: inv }); }
  const reserved = Number((await one<any>(
    `SELECT COALESCE(SUM(r.amount_usd),0) AS s FROM cash_reservations r JOIN orders o ON o.id=r.order_id
      WHERE r.account_id=$1 AND o.status IN ('validated','submitted','partially_filled','pending_approval','unknown')`, [acct.id]).catch(() => null))?.s ?? 0);
  const pending = Number((await one<any>("SELECT COALESCE(SUM(notional_usd),0) AS s FROM orders WHERE user_id=$1 AND source='agent' AND status='pending_approval'", [userId]))?.s ?? 0);
  const fleetsReserve = Number((await one<any>("SELECT COALESCE(SUM(reserve_usd),0) AS s FROM agent_fleets WHERE user_id=$1 AND status <> 'archived'", [userId]))?.s ?? 0);
  const allocated = per.reduce((s, a) => s + a.capital, 0);
  const total = Number(acct.cash_balance) + invested;
  return { accountId: acct.id, cash: Number(acct.cash_balance), total, allocated, invested, reserved, pending, fleetsReserve,
    unallocated: Math.max(0, total - allocated - fleetsReserve), allocatedPct: total > 0 ? (allocated / total) * 100 : 0, agents: per };
}
/** Reject allocations above available funds (atomic: per-user advisory lock). */
async function assertCapital(c: any, userId: string, newCapital: number, excludeAgentId: string | null, extraReserve = 0) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agentcap:${userId}`]);
  const acct = await paperAccount(userId, c);
  const others = await q<any>("SELECT id, capital_usd FROM agents WHERE user_id=$1 AND status <> 'archived' AND ($2::uuid IS NULL OR id <> $2)", [userId, excludeAgentId], c);
  let invested = 0;
  for (const a of others) invested += await investedBy(a.id, c);
  if (excludeAgentId) invested += await investedBy(excludeAgentId, c);
  const allocated = others.reduce((s, a) => s + Number(a.capital_usd), 0);
  const reserve = Number((await one<any>("SELECT COALESCE(SUM(reserve_usd),0) AS s FROM agent_fleets WHERE user_id=$1 AND status <> 'archived'", [userId], c))?.s ?? 0) + extraReserve;
  const total = Number(acct.cash_balance) + invested;
  if (allocated + reserve + newCapital > total + 0.005)
    throw new HttpError(400, `Allocations would exceed available paper capital: $${(allocated + reserve + newCapital).toFixed(2)} requested of $${total.toFixed(2)}`, "OVER_ALLOCATION");
  return acct;
}

/* ───────────────────────── Create / version ───────────────────────── */
function configOf(a: any) {
  return { name: a.name, role: a.role, instructions: a.instructions, asset_ids: a.asset_ids, universe: a.universe, strategy: a.strategy, model: a.model,
    tool_policy: a.tool_policy, autonomy_level: a.autonomy_level, mode: a.mode, capital_usd: Number(a.capital_usd), risk: a.risk, schedule: a.schedule, locked_strategy: a.locked_strategy };
}
async function snapshotVersion(c: any, a: any, note: string, by = "user") {
  await c.query("INSERT INTO agent_versions (agent_id, version, config, change_note, created_by) VALUES ($1,$2,$3,$4,$5)", [a.id, a.version, JSON.stringify(configOf(a)), note, by]);
}

function normalise(role: string, input: { autonomy?: number; capitalUsd?: number; strategy?: any }, isOwner: boolean) {
  const def = roleById(role)!;
  let autonomy = input.autonomy ?? def.defaultAutonomy;
  let capital = input.capitalUsd ?? 0;
  const notes: string[] = [];
  // Research-only roles: no trading credentials or capital, max autonomy Prepare (spec §00, §09).
  if (!def.trades) {
    if (autonomy > 3) { autonomy = 3; notes.push(`${def.name} agents are research-only: autonomy capped at Prepare`); }
    if (capital > 0) { capital = 0; notes.push(`${def.name} agents don't receive trading capital`); }
  }
  if ((role === "mimic" || role === "copy_trading") && !isOwner && autonomy > 3) { autonomy = 3; notes.push("Mimic and copy execution is owner-only; this agent will flag opportunities for review"); }
  const kind: StrategyKind = (input.strategy?.kind as StrategyKind) ?? def.strategy;
  const strategy = StrategySchema.parse({ ...defaultStrategy(kind), ...(input.strategy ?? {}), kind });
  if (def.trades && capital > 0 && strategy.tradeUsd > capital) strategy.tradeUsd = Math.max(1, Math.round(capital / Math.max(2, strategy.maxOpen) * 100) / 100);
  return { autonomy, capital, strategy, notes };
}

export async function createAgent(userId: string, raw: AgentInputT, opts: { fleetId?: string | null; lineage?: string; parentId?: string | null; status?: AgentStatus; isOwner?: boolean; by?: string } = {}) {
  const input = AgentInput.parse(raw);
  if (input.mode === "live") throw new HttpError(403, LIVE_LOCK, "LIVE_LOCKED");
  const res = await resolveAssetRefs(input.assets);
  if (input.assets.length && !res.ids.length && !input.scan) throw new HttpError(422, `Couldn't find ${res.unresolved.join(", ")}`);
  const n = normalise(input.role, input, !!opts.isOwner);
  const schedule = ScheduleSchema.parse(input.schedule ?? {});
  const universe = { symbols: res.symbols, wallets: input.wallets, scan: input.scan ?? null, unresolved: res.unresolved };
  const agent = await tx(async (c) => {
    const acct = n.capital > 0 ? await assertCapital(c, userId, n.capital, null) : await paperAccount(userId, c);
    const a = await one<any>(
      `INSERT INTO agents (user_id, fleet_id, parent_id, lineage, name, role, instructions, asset_ids, universe, strategy, model, tool_policy, autonomy_level, mode, account_id, capital_usd, risk, schedule, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'paper',$14,$15,$16,$17,$18) RETURNING *`,
      [userId, opts.fleetId ?? null, opts.parentId ?? null, opts.lineage ?? "created", input.name, input.role, input.instructions || roleById(input.role)!.defaultInstructions,
        res.ids, JSON.stringify(universe), JSON.stringify(n.strategy), input.model, JSON.stringify(input.toolPolicy ?? { shareKnowledge: true }), n.autonomy, acct.id, n.capital,
        JSON.stringify(input.risk ?? {}), JSON.stringify(schedule), opts.status ?? "configured"], c);
    await snapshotVersion(c, a, opts.lineage && opts.lineage !== "created" ? `${opts.lineage} agent` : "Created", opts.by ?? "user");
    return a;
  });
  await audit({ actorType: "user", actorId: userId, userId, action: "agent.created", target: `agent:${agent.id}`, data: { role: agent.role, autonomy: agent.autonomy_level, capital: agent.capital_usd, lineage: agent.lineage } }).catch(() => {});
  await emit(userId, { agentId: agent.id, fleetId: agent.fleet_id, version: 1, kind: "state", title: `${agent.name} created`,
    body: [`${roleById(agent.role)!.name} agent · autonomy ${agent.autonomy_level} · paper`, ...n.notes, res.unresolved.length ? `Not found: ${res.unresolved.join(", ")}` : ""].filter(Boolean).join(". ") });
  // Active skills (stop-loss / take-profit / amount / dip) apply to new agents too.
  await (await import("../skills")).applySkillsToNew(userId, "agent", agent.id, agent.name).catch(() => {});
  return { ...agent, notes: n.notes };
}

async function load(userId: string, id: string, c?: any) {
  const a = await one<any>("SELECT * FROM agents WHERE id=$1 AND user_id=$2", [id, userId], c);
  if (!a) throw new HttpError(404, "Agent not found");
  return a;
}

/** Live prompt editing / settings change → a new immutable version. Agents themselves can't call this. */
export async function updateAgent(userId: string, id: string, patch: AgentPatchT, opts: { isOwner?: boolean; by?: string } = {}) {
  if (patch.mode === "live") throw new HttpError(403, LIVE_LOCK, "LIVE_LOCKED");
  const cur = await load(userId, id);
  if (cur.status === "archived") throw new HttpError(409, "Archived agents can't be edited");
  if (cur.locked_strategy && patch.strategy && patch.lockedStrategy !== false) throw new HttpError(409, "Strategy is locked. Unlock it first.");
  let assetIds = cur.asset_ids, universe = cur.universe ?? {};
  if (patch.assets) { const r = await resolveAssetRefs(patch.assets); assetIds = r.ids; universe = { ...universe, symbols: r.symbols, unresolved: r.unresolved }; }
  if (patch.wallets) universe = { ...universe, wallets: patch.wallets };
  const n = normalise(cur.role, { autonomy: patch.autonomy ?? cur.autonomy_level, capitalUsd: patch.capitalUsd ?? Number(cur.capital_usd), strategy: { ...cur.strategy, ...(patch.strategy ?? {}) } }, !!opts.isOwner);
  const schedule = patch.schedule ? ScheduleSchema.parse({ ...cur.schedule, ...patch.schedule }) : cur.schedule;
  const material = patch.strategy || patch.assets || patch.autonomy !== undefined || patch.capitalUsd !== undefined || patch.risk || patch.instructions !== undefined;
  const updated = await tx(async (c) => {
    if (patch.capitalUsd !== undefined && n.capital !== Number(cur.capital_usd)) await assertCapital(c, userId, n.capital, id);
    const a = await one<any>(
      `UPDATE agents SET name=$3, instructions=$4, asset_ids=$5, universe=$6, strategy=$7, model=$8, autonomy_level=$9, capital_usd=$10, risk=$11, schedule=$12,
              locked_strategy=$13, pinned=$14, version=version + $15, revision=revision+1, updated_at=now()
        WHERE id=$1 AND user_id=$2 RETURNING *`,
      [id, userId, patch.name ?? cur.name, patch.instructions ?? cur.instructions, assetIds, JSON.stringify(universe), JSON.stringify(n.strategy), patch.model ?? cur.model,
        n.autonomy, n.capital, JSON.stringify(patch.risk ? RiskSchema.parse(patch.risk) : cur.risk), JSON.stringify(schedule), patch.lockedStrategy ?? cur.locked_strategy,
        patch.pinned ?? cur.pinned, material ? 1 : 0], c);
    if (material) await snapshotVersion(c, a, patch.note ?? "Edited", opts.by ?? "user");
    return a;
  });
  if (material) {
    await emit(userId, { agentId: id, fleetId: updated.fleet_id, version: updated.version, kind: "state", title: `${updated.name} updated to v${updated.version}`, body: [patch.note, ...n.notes].filter(Boolean).join(". ") });
    await audit({ actorType: "user", actorId: userId, userId, action: "agent.updated", target: `agent:${id}`, data: { version: updated.version, autonomy: updated.autonomy_level, capital: updated.capital_usd } }).catch(() => {});
  }
  return { ...updated, notes: n.notes };
}

/** Restore a previous version as a new version (history is never rewritten). */
export async function restoreVersion(userId: string, id: string, version: number) {
  const cur = await load(userId, id);
  const v = await one<any>("SELECT config FROM agent_versions WHERE agent_id=$1 AND version=$2", [id, version]);
  if (!v) throw new HttpError(404, "Version not found");
  const cfg = v.config;
  return updateAgent(userId, id, { instructions: cfg.instructions, strategy: cfg.strategy, autonomy: cfg.autonomy_level, capitalUsd: cfg.capital_usd, risk: cfg.risk, schedule: cfg.schedule, note: `Restored v${version}`, lockedStrategy: false }, { isOwner: true })
    .then(async (a) => { if (JSON.stringify(cfg.asset_ids) !== JSON.stringify(cur.asset_ids)) await q("UPDATE agents SET asset_ids=$2 WHERE id=$1", [id, cfg.asset_ids]); return a; });
}

/* ───────────────────────── Lifecycle (spec §09 state machine) ───────────────────────── */
const ALLOWED: Record<AgentAction, AgentStatus[]> = {
  approve: ["pending_approval"],
  reject: ["pending_approval"],
  start: ["draft", "configured", "paused", "failed", "completed", "risk_blocked"],
  pause: ["queued", "running", "risk_blocked"],
  resume: ["paused"],
  stop: ["queued", "running", "paused", "risk_blocked", "pending_approval", "failed"],
  archive: ["draft", "configured", "paused", "failed", "completed", "risk_blocked"],
  cancel_orders: ["draft", "configured", "pending_approval", "queued", "running", "paused", "risk_blocked", "failed", "completed"],
  close_positions: ["draft", "configured", "pending_approval", "queued", "running", "paused", "risk_blocked", "failed", "completed"],
  fork: ["draft", "configured", "pending_approval", "queued", "running", "paused", "risk_blocked", "failed", "completed", "archived"],
};

export async function cancelAgentOrders(userId: string, agentId: string) {
  const open = await q<any>("SELECT id FROM orders WHERE user_id=$1 AND source='agent' AND source_ref=$2 AND status IN ('pending_approval','validated','submitted','partially_filled')", [userId, agentId]);
  let n = 0;
  for (const o of open) { try { await cancel(o.id, userId, "Cancelled by agent control"); n++; } catch {} }
  return n;
}
export async function closeAgentPositions(userId: string, agentId: string, why = "Close positions") {
  const a = await load(userId, agentId);
  const out: any[] = [];
  for (const p of await positionsFor(agentId)) {
    try {
      const r: any = await place({ asset: { assetId: p.assetId }, side: "sell", orderType: "market", quantity: p.qty, timeInForce: "gtc" } as any,
        { userId, source: "agent", sourceRef: agentId, idempotencyKey: `agent-close:${agentId}:${p.assetId}:${Date.now()}`, actor: { type: "user", id: userId }, userConfirmed: true });
      out.push({ symbol: p.symbol, status: r.order?.status ?? r.status });
    } catch (e: any) { out.push({ symbol: p.symbol, error: e.message }); }
  }
  await emit(userId, { agentId, fleetId: a.fleet_id, version: a.version, kind: "execution", title: `${why}: ${out.length} position${out.length === 1 ? "" : "s"}`, body: out.map((o) => `${o.symbol}: ${o.error ?? o.status}`).join(" · "), data: { results: out } });
  return out;
}

export async function agentAction(userId: string, id: string, action: AgentAction, opts: { expectedRevision?: number; reason?: string; isOwner?: boolean } = {}) {
  const a = await load(userId, id);
  if (opts.expectedRevision && opts.expectedRevision !== a.revision) throw new HttpError(409, "This agent changed in the meantime. Refresh and try again.");
  if (!ALLOWED[action].includes(a.status)) throw new HttpError(409, `Can't ${action.replace("_", " ")} an agent that is ${a.status.replace("_", " ")}`);
  if (action === "fork") return forkAgent(userId, id, { isOwner: opts.isOwner });
  if (action === "cancel_orders") { const n = await cancelAgentOrders(userId, id); await emit(userId, { agentId: id, fleetId: a.fleet_id, kind: "state", title: `Cancelled ${n} open order${n === 1 ? "" : "s"}` }); return load(userId, id); }
  if (action === "close_positions") { await closeAgentPositions(userId, id); return load(userId, id); }
  let next: AgentStatus = a.status;
  if (action === "start") {
    if (a.mode === "live") throw new HttpError(403, LIVE_LOCK, "LIVE_LOCKED");
    if (a.fleet_id) { const f = await one<any>("SELECT status FROM agent_fleets WHERE id=$1", [a.fleet_id]); if (f?.status === "risk_blocked") throw new HttpError(409, "The fleet is risk-blocked. Review the loss limit before restarting."); }
    next = "queued"; // the user starting it is the approval of this configuration
  }
  if (action === "approve") next = "queued";
  if (action === "reject") next = "configured";
  if (action === "pause") next = "paused";
  if (action === "resume") next = "queued";
  if (action === "stop") next = "completed";
  if (action === "archive") { await cancelAgentOrders(userId, id); next = "archived"; }
  const row = await one<any>("UPDATE agents SET status=$3, stop_reason=$4, fail_count=0, revision=revision+1, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",
    [id, userId, next, ["pause", "stop", "archive", "reject"].includes(action) ? (opts.reason ?? `${action} by you`) : null]);
  await emit(userId, { agentId: id, fleetId: a.fleet_id, version: a.version, kind: "state", title: `${a.name}: ${a.status.replace("_", " ")} → ${next.replace("_", " ")}`, body: opts.reason ?? `${action} by you`, data: { from: a.status, to: next, action } });
  await audit({ actorType: "user", actorId: userId, userId, action: `agent.${action}`, target: `agent:${id}`, data: { from: a.status, to: next, reason: opts.reason ?? null } }).catch(() => {});
  return row;
}

/* ───────────────────────── Fork / merge / handoff (spec §05, genealogy §13) ───────────────────────── */
export async function forkAgent(userId: string, id: string, opts: { name?: string; strategy?: any; isOwner?: boolean; lineage?: "forked" | "spawned"; capitalUsd?: number } = {}) {
  const a = await load(userId, id);
  return createAgent(userId, {
    name: (opts.name ?? `${a.name} (fork)`).slice(0, 60), role: a.role, instructions: a.instructions, assets: a.asset_ids, wallets: a.universe?.wallets ?? [], scan: a.universe?.scan ?? undefined,
    strategy: { ...a.strategy, ...(opts.strategy ?? {}) }, model: a.model, autonomy: a.autonomy_level, capitalUsd: opts.capitalUsd ?? 0, risk: a.risk, schedule: a.schedule,
  }, { fleetId: a.fleet_id, lineage: opts.lineage ?? "forked", parentId: a.id, status: "configured", isOwner: opts.isOwner });
}
export async function mergeAgents(userId: string, ids: string[], name?: string, opts: { isOwner?: boolean } = {}) {
  if (ids.length < 2) throw new HttpError(400, "Pick at least two agents to merge");
  const list = await Promise.all(ids.map((i) => load(userId, i)));
  const roles = new Set(list.map((a) => roleById(a.role)!.trades));
  if (roles.size > 1) throw new HttpError(409, "Can't merge a trading agent with a research-only agent: their permissions conflict");
  const conflicts: string[] = [];
  const kinds = new Set(list.map((a) => a.strategy?.kind));
  if (kinds.size > 1) conflicts.push(`Strategies differ (${[...kinds].join(", ")}): kept ${list[0].strategy?.kind} from ${list[0].name}`);
  const autonomy = Math.min(...list.map((a) => a.autonomy_level));
  if (new Set(list.map((a) => a.autonomy_level)).size > 1) conflicts.push(`Autonomy differs: used the most restrictive (${autonomy})`);
  const assets = [...new Set(list.flatMap((a) => a.asset_ids))];
  const merged = await createAgent(userId, {
    name: (name ?? list.map((a) => a.name.split(" ")[0]).join(" + ")).slice(0, 60), role: list[0].role,
    instructions: list.map((a) => `[${a.name}] ${a.instructions}`).join("\n").slice(0, 4000), assets, strategy: list[0].strategy, model: list[0].model, autonomy, capitalUsd: 0, risk: list[0].risk,
  }, { fleetId: list[0].fleet_id, lineage: "merged", parentId: list[0].id, status: "configured", isOwner: opts.isOwner });
  await q("UPDATE agents SET state = jsonb_set(state, '{mergedFrom}', $2::jsonb) WHERE id=$1", [merged.id, JSON.stringify(list.map((a) => ({ id: a.id, name: a.name })))]);
  await emit(userId, { agentId: merged.id, kind: "state", title: `Merged ${list.length} agents`, body: conflicts.length ? `Resolved conflicts: ${conflicts.join("; ")}` : "No policy conflicts", data: { from: ids, conflicts } });
  return { ...merged, conflicts };
}
/** Auditable transfer of position-management responsibility for one asset from agent A to agent B. */
export async function handoff(userId: string, fromId: string, toId: string, assetId: string, note?: string) {
  if (fromId === toId) throw new HttpError(400, "Pick a different agent");
  const [from, to] = [await load(userId, fromId), await load(userId, toId)];
  if (!roleById(to.role)!.trades) throw new HttpError(409, `${to.name} is research-only and can't manage positions`);
  const pos = (await positionsFor(fromId)).find((p) => p.assetId === assetId);
  if (!pos) throw new HttpError(404, `${from.name} has no open position in that asset`);
  await tx(async (c) => {
    const fa = (await one<any>("SELECT state FROM agents WHERE id=$1 FOR UPDATE", [fromId], c)).state?.adjust ?? {};
    const ta = (await one<any>("SELECT state FROM agents WHERE id=$1 FOR UPDATE", [toId], c)).state?.adjust ?? {};
    fa[assetId] = { qty: (fa[assetId]?.qty ?? 0) - pos.qty, cost: (fa[assetId]?.cost ?? 0) - pos.cost, symbol: pos.symbol };
    ta[assetId] = { qty: (ta[assetId]?.qty ?? 0) + pos.qty, cost: (ta[assetId]?.cost ?? 0) + pos.cost, symbol: pos.symbol };
    await c.query("UPDATE agents SET state = jsonb_set(state, '{adjust}', $2::jsonb) WHERE id=$1", [fromId, JSON.stringify(fa)]);
    await c.query("UPDATE agents SET state = jsonb_set(state, '{adjust}', $2::jsonb) WHERE id=$1", [toId, JSON.stringify(ta)]);
  });
  const body = `${pos.qty.toPrecision(6)} ${pos.symbol} @ $${pos.entry.toPrecision(6)}${note ? `. ${note}` : ""}`;
  await emit(userId, { agentId: fromId, fleetId: from.fleet_id, kind: "state", title: `Handed off ${pos.symbol} to ${to.name}`, body });
  await emit(userId, { agentId: toId, fleetId: to.fleet_id, kind: "state", title: `Took over ${pos.symbol} from ${from.name}`, body });
  await postMessage(userId, { room: from.fleet_id ? `fleet:${from.fleet_id}` : "general", fleetId: from.fleet_id, senderAgentId: fromId, senderLabel: from.name, recipients: [to.name], msgType: "handoff", body: `Handing off ${body}` });
  await audit({ actorType: "user", actorId: userId, userId, action: "agent.handoff", target: `agent:${fromId}`, data: { to: toId, assetId, qty: pos.qty } }).catch(() => {});
  return { ok: true };
}

/* ───────────────────────── Reading ───────────────────────── */
export async function snapshotsFor(agentId: string, limit = 96) {
  return (await q<any>("SELECT extract(epoch from ts)*1000 AS t, equity_usd FROM agent_snapshots WHERE agent_id=$1 ORDER BY ts DESC LIMIT $2", [agentId, limit])).reverse().map((r) => ({ t: Number(r.t), v: Number(r.equity_usd) }));
}
export async function metricsFor(a: any) {
  const pos = await positionsFor(a.id);
  const unreal = pos.reduce((s, p) => s + p.pnl, 0), invested = pos.reduce((s, p) => s + p.cost, 0);
  const realized = Number(a.realized_pnl_usd ?? 0);
  const st = await one<any>(
    `SELECT count(*) FILTER (WHERE side='sell' AND filled_quantity>0)::int AS closes, count(*) FILTER (WHERE side='sell' AND realized_pnl > 0)::int AS wins,
            count(*) FILTER (WHERE filled_quantity>0)::int AS fills, count(*) FILTER (WHERE status='pending_approval')::int AS pending,
            count(*) FILTER (WHERE filled_quantity>0 AND updated_at > now() - interval '24 hours')::int AS fills_24h,
            COALESCE(SUM(realized_pnl) FILTER (WHERE updated_at > now() - interval '24 hours'),0) AS realized_24h, COALESCE(SUM(fees_usd),0) AS fees
       FROM orders WHERE source='agent' AND source_ref=$1`, [a.id]);
  const cap = Number(a.capital_usd);
  const pnl = realized + unreal;
  return {
    capital: cap, invested, positions: pos.length, realized, unrealized: unreal, pnl, pnlPct: cap > 0 ? (pnl / cap) * 100 : 0,
    pnl24h: Number(st?.realized_24h ?? 0) + unreal, winRate: st?.closes ? (st.wins / st.closes) * 100 : null, trades: st?.fills ?? 0, trades24h: st?.fills_24h ?? 0,
    pendingApprovals: st?.pending ?? 0, fees: Number(st?.fees ?? 0), opportunities: a.metrics?.opportunities ?? null, signals: a.metrics?.signals ?? null,
    qualified: a.metrics?.qualified ?? null, fresh: a.metrics?.fresh ?? null,
  };
}
export async function listAgents(userId: string, opts: { fleetId?: string | null; archived?: boolean } = {}) {
  const rows = await q<any>(
    `SELECT a.*, f.name AS fleet_name, (SELECT title FROM agent_events e WHERE e.agent_id=a.id ORDER BY id DESC LIMIT 1) AS last_event,
            (SELECT array_agg(symbol) FROM assets WHERE id = ANY(a.asset_ids)) AS symbols
       FROM agents a LEFT JOIN agent_fleets f ON f.id=a.fleet_id
      WHERE a.user_id=$1 AND ($2 OR a.status <> 'archived') AND ($3::uuid IS NULL OR a.fleet_id=$3)
      ORDER BY a.pinned DESC, a.created_at DESC`, [userId, !!opts.archived, opts.fleetId ?? null]);
  return Promise.all(rows.map(async (a) => ({ ...a, roleName: roleById(a.role)?.name ?? a.role, routedModel: routeModel(a.role, a.model), metrics: await metricsFor(a), spark: await snapshotsFor(a.id, 48) })));
}
export async function agentDetail(userId: string, id: string) {
  const a = await load(userId, id);
  const [versions, events, orders, positions, spark, children, candidates, parent] = await Promise.all([
    q("SELECT version, change_note, created_by, created_at, config FROM agent_versions WHERE agent_id=$1 ORDER BY version DESC LIMIT 50", [id]),
    q("SELECT * FROM agent_events WHERE agent_id=$1 ORDER BY id DESC LIMIT 100", [id]),
    q(`SELECT o.id, o.side, o.status, o.status_reason, o.quantity, o.notional_usd, o.filled_quantity, o.avg_fill_price, o.realized_pnl, o.created_at, a.symbol
         FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.source='agent' AND o.source_ref=$1 ORDER BY o.created_at DESC LIMIT 50`, [id]),
    positionsFor(id), snapshotsFor(id, 200),
    q("SELECT id, name, lineage, status, created_at FROM agents WHERE parent_id=$1 ORDER BY created_at", [id]),
    q("SELECT * FROM agent_training_candidates WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 10", [id]),
    a.parent_id ? one("SELECT id, name, lineage FROM agents WHERE id=$1", [a.parent_id]) : Promise.resolve(null),
  ]);
  const symbols = (await q<any>("SELECT id, symbol, name, last_price, change_24h, logo_url, asset_class FROM assets WHERE id = ANY($1)", [a.asset_ids]));
  return { agent: { ...a, roleName: roleById(a.role)?.name, routedModel: routeModel(a.role, a.model), metrics: await metricsFor(a) }, assets: symbols, versions, events, orders, positions, spark, genealogy: { parent, children }, candidates };
}

export async function listEvents(userId: string, opts: { agentId?: string | null; fleetId?: string | null; kind?: string | null; before?: number | null; limit?: number } = {}) {
  return q<any>(
    `SELECT e.*, a.name AS agent_name, a.role AS agent_role FROM agent_events e LEFT JOIN agents a ON a.id=e.agent_id
      WHERE e.user_id=$1 AND ($2::uuid IS NULL OR e.agent_id=$2) AND ($3::uuid IS NULL OR e.fleet_id=$3) AND ($4::text IS NULL OR e.kind=$4) AND ($5::bigint IS NULL OR e.id < $5)
      ORDER BY e.id DESC LIMIT $6`, [userId, opts.agentId ?? null, opts.fleetId ?? null, opts.kind ?? null, opts.before ?? null, Math.min(200, opts.limit ?? 60)]);
}

/* ───────────────────────── Rooms (Merod Nexus, spec §06) ───────────────────────── */
const MAX_DEPTH = 4;
export async function postMessage(userId: string, m: { room: string; fleetId?: string | null; senderAgentId?: string | null; senderLabel: string; recipients?: string[]; msgType: string; body: string; refs?: unknown[]; correlationId?: string | null; depth?: number }) {
  if ((m.depth ?? 0) > MAX_DEPTH) return null; // circular message storm guard
  const recent = await one<any>("SELECT count(*)::int AS n FROM agent_messages WHERE user_id=$1 AND room=$2 AND created_at > now() - interval '1 minute'", [userId, m.room]);
  if ((recent?.n ?? 0) > 60) return null; // rate guard per room
  const row = await one<any>(
    `INSERT INTO agent_messages (user_id, room, fleet_id, sender_agent_id, sender_label, recipients, msg_type, body, refs, correlation_id, depth)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [userId, m.room, m.fleetId ?? null, m.senderAgentId ?? null, m.senderLabel.slice(0, 60), m.recipients ?? [], m.msgType, m.body.slice(0, 2000), JSON.stringify(m.refs ?? []), m.correlationId ?? null, m.depth ?? 0]);
  await publish(`user:${userId}`, "agent_message", row).catch(() => {});
  return row;
}
export async function listRooms(userId: string) {
  const fleets = await q<any>("SELECT id, name, status FROM agent_fleets WHERE user_id=$1 AND status <> 'archived' ORDER BY created_at DESC", [userId]);
  const counts = await q<any>("SELECT room, count(*)::int AS n, max(created_at) AS last FROM agent_messages WHERE user_id=$1 GROUP BY room", [userId]);
  const c = new Map(counts.map((r) => [r.room, r]));
  return [{ id: "general", name: "General", fleetId: null, ...(c.get("general") ?? { n: 0 }) }, ...fleets.map((f) => ({ id: `fleet:${f.id}`, name: f.name, fleetId: f.id, status: f.status, ...(c.get(`fleet:${f.id}`) ?? { n: 0 }) }))];
}
export async function roomMessages(userId: string, room: string, limit = 100) {
  return (await q<any>("SELECT * FROM agent_messages WHERE user_id=$1 AND room=$2 ORDER BY id DESC LIMIT $3", [userId, room, limit])).reverse();
}

/* ───────────────────────── Knowledge (Merod Vault) ───────────────────────── */
export async function addKnowledge(userId: string, k: { fleetId?: string | null; agentId?: string | null; topic: string; body: string; source?: string | null }) {
  if (k.agentId) {
    const a = await one<any>("SELECT tool_policy FROM agents WHERE id=$1 AND user_id=$2", [k.agentId, userId]);
    if (a?.tool_policy?.shareKnowledge === false) return null; // agent not authorised to contribute
  }
  const dupe = await one("SELECT 1 FROM agent_knowledge WHERE user_id=$1 AND topic=$2 AND body=$3 AND created_at > now() - interval '6 hours'", [userId, k.topic, k.body]);
  if (dupe) return null;
  return one("INSERT INTO agent_knowledge (user_id, fleet_id, agent_id, topic, body, source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [userId, k.fleetId ?? null, k.agentId ?? null, k.topic.slice(0, 120), k.body.slice(0, 2000), k.source ?? null]);
}
export async function listKnowledge(userId: string, limit = 100) {
  return q("SELECT k.*, a.name AS agent_name FROM agent_knowledge k LEFT JOIN agents a ON a.id=k.agent_id WHERE k.user_id=$1 ORDER BY k.id DESC LIMIT $2", [userId, limit]);
}

/* ───────────────────────── Memory ───────────────────────── */
export async function remember(agentId: string, kind: "notes" | "lessons" | "preferences", text: string) {
  await q(`UPDATE agents SET memory = jsonb_set(memory, ARRAY[$2], (COALESCE(memory->$2, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('t', now(), 'text', $3::text)))
            - CASE WHEN jsonb_array_length(COALESCE(memory->$2,'[]'::jsonb)) >= 50 THEN 0 ELSE 1000 END) WHERE id=$1`, [agentId, kind, text.slice(0, 500)]);
}

export { ROLES };
