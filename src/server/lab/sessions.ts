import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { publish } from "../realtime";
import { createBot, type BotConfig } from "../bots/service";
import { setBotStatus } from "../bots/runner";
import { cancel, reservedCash } from "../engine/engine";
import { validateRules, type StrategyRulesT } from "./strategies";

/**
 * MEROD MULTI — concurrent trading sessions (spec §03).
 * A session = one strategy version + its own budget, account, mode and lifecycle. Sessions run on the server (the
 * existing bot runner executes them), so closing the browser doesn't stop them. Every transition is a server command
 * with an expected revision; who/what/why is recorded. Budgets are virtual allocations checked against the account's
 * cash minus open reservations and other active sessions; the order engine's reservation ledger stops two sessions
 * from spending the same cash.
 */
export type SessionState = "DRAFT" | "VALIDATING" | "READY" | "RUNNING" | "PAUSING" | "PAUSED" | "AWAITING_APPROVAL" | "BLOCKED" | "DEGRADED" | "STOPPING" | "STOPPED" | "ERROR" | "ARCHIVED";
export type SessionAction = "start" | "pause" | "resume" | "stop" | "archive" | "clone" | "rename";
const ACTIVE: SessionState[] = ["READY", "RUNNING", "PAUSING", "PAUSED", "AWAITING_APPROVAL", "DEGRADED"];

const SCHEDULE: Record<string, BotConfig["schedule"]> = { "15s": "every_15s", "1m": "every_1m", "5m": "every_5m", "1h": "every_1h", "1d": "every_1h" };

/** Turn a strategy version into the bot config that executes it (null for watch-only scanners). */
export async function botConfigFor(title: string, r: StrategyRulesT, allocation: number, accountId: string | null): Promise<BotConfig | null> {
  if (r.template === "scanner" || r.approvalPolicy === "observation") return null;
  let assetIds = r.universe.assetIds;
  if (!assetIds.length && r.universe.scanner) {
    const sc = r.universe.scanner;
    assetIds = (await q<{ id: string }>(
      `SELECT id FROM assets WHERE NOT ('demo_data'=ANY(risk_flags)) AND tradability IN ('paper_tradable','live_tradable')
         AND last_price IS NOT NULL AND price_source IS NOT NULL AND price_source <> 'simulated'
         AND ($1::text IS NULL OR asset_class=$1) AND ($2::text IS NULL OR venue=$2) AND (NOT $3 OR EXISTS (SELECT 1 FROM unnest(categories) c WHERE c ILIKE '%meme%'))
       ORDER BY volume_24h DESC NULLS LAST LIMIT $4`, [sc.assetClass, sc.venue, sc.meme, sc.limit])).map((x) => x.id);
  }
  if (!assetIds.length) throw new HttpError(422, "No tradable assets with live prices match this strategy right now");
  const usd = r.sizingRules.usdPerTrade ?? Math.max(1, allocation / 10);
  const e = r.entryRules[0];
  let strategyId: string, params: Record<string, unknown>;
  if (r.template === "dip_loop" && e?.type === "dip_pct") { strategyId = "dip_rebound_loop"; params = { amount_usd: usd, dip_pct: e.value, take_profit_pct: r.exitRules.takeProfitPct ?? 3, stop_loss_pct: r.exitRules.stopLossPct, repeat: r.repeat, max_cycles: null }; }
  else if ((r.template === "sma_cross" || r.template === "momentum") && e?.type === "sma_cross_up") { strategyId = "technical_indicator"; params = { fast: e.fast, slow: e.slow, amount_usd: usd }; }
  else if (r.template === "momentum") { strategyId = "technical_indicator"; params = { fast: 5, slow: 20, amount_usd: usd }; }
  else if (r.template === "dca" && e?.type === "schedule") { strategyId = "recurring_buy"; params = { amount_usd: usd, frequency: e.frequency, weekday: e.weekday }; }
  else if (r.template === "price_trigger" && (e?.type === "price_above" || e?.type === "price_below")) { strategyId = "price_trigger"; params = { condition: e.type, value: e.value, side: "buy", amount_usd: usd, percent: null }; }
  else throw new HttpError(422, `This strategy's ${r.template} rules can't run yet`);
  return {
    name: title.slice(0, 80), description: `Session: ${title}`, strategyId, params, assetIds: assetIds.slice(0, 20), markets: [], accountId: accountId ?? undefined,
    isPaper: r.environment !== "live", budgetUsd: Math.min(1_000_000, allocation), maxPositionUsd: r.sizingRules.maxPositionUsd ?? usd, maxDailySpendUsd: allocation,
    maxDailyLossUsd: r.riskPolicy.dailyLossUsd ?? Math.max(1, allocation * 0.2), maxTradesPerDay: null, minLiquidityUsd: 0, maxSlippageBps: r.orderPolicy.maxSlippageBps,
    maxPriceDeviationPct: 5, profitTargetPct: r.exitRules.takeProfitPct, stopLossPct: r.exitRules.stopLossPct, schedule: SCHEDULE[r.cadence] ?? "every_1m",
    approvalRequired: r.approvalPolicy === "approval" || r.approvalPolicy === "manual", notify: { trades: true, errors: true }, start: false,
  } as BotConfig;
}

async function load(userId: string, id: string) {
  const s = await one<any>(
    `SELECT s.*, v.rules, v.version, v.summary, v.content_hash, st.name AS strategy_name FROM trading_sessions s
       JOIN strategy_versions v ON v.id=s.strategy_version_id JOIN strategies st ON st.id=v.strategy_id
      WHERE s.id=$1 AND s.user_id=$2`, [id, userId]);
  if (!s) throw new HttpError(404, "Session not found");
  return s;
}

/** Move to a new state only if the revision still matches (optimistic concurrency); record who/what/why. */
async function transition(s: any, to: SessionState, action: string, actorId: string, reason?: string, extra: Record<string, unknown> = {}) {
  const cols = Object.keys(extra).filter((k) => ["title", "bot_id", "last_error"].includes(k)); // fixed allow-list of columns
  const sets = cols.map((k, i) => `${k}=$${i + 4}`);
  const r = await one<any>(
    `UPDATE trading_sessions SET state=$3, revision=revision+1, updated_at=now()${sets.length ? ", " + sets.join(", ") : ""} WHERE id=$1 AND revision=$2 RETURNING *`,
    [s.id, s.revision, to, ...cols.map((k) => extra[k])]);
  if (!r) throw new HttpError(409, "This session changed in the meantime. Refresh and try again.");
  await q("INSERT INTO session_events (session_id, actor_id, action, from_state, to_state, revision, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)", [s.id, actorId, action, s.state, to, r.revision, reason ?? null]);
  await publish(`user:${s.user_id}`, "session", { id: s.id, state: to, revision: r.revision });
  return { ...s, ...r };
}

export async function createSession(userId: string, b: { title: string; strategyVersionId: string; allocationUsd: number; accountId?: string | null }) {
  const v = await one<any>("SELECT v.id, v.rules FROM strategy_versions v JOIN strategies s ON s.id=v.strategy_id WHERE v.id=$1 AND s.user_id=$2", [b.strategyVersionId, userId]);
  if (!v) throw new HttpError(404, "Strategy version not found");
  if (b.accountId && !(await one("SELECT 1 FROM trading_accounts WHERE id=$1 AND user_id=$2 AND status='active'", [b.accountId, userId]))) throw new HttpError(400, "That account isn't yours or isn't active");
  const r = await one<any>(
    `INSERT INTO trading_sessions (user_id, title, strategy_version_id, environment, account_id, allocation_usd, mode) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, b.title.slice(0, 80), v.id, v.rules.environment, b.accountId ?? null, b.allocationUsd, v.rules.approvalPolicy]);
  await q("INSERT INTO session_events (session_id, actor_id, action, to_state, revision, reason) VALUES ($1,$2,'create','DRAFT',1,$3)", [r.id, userId, `allocation $${b.allocationUsd}`]);
  await audit({ actorType: "user", actorId: userId, userId, action: "session.create", target: r.id, data: { version: v.id, allocation: b.allocationUsd } });
  return r;
}

/** Account capacity left for a new/resumed session: cash − open reservations − other active sessions' allocations. */
async function capacity(userId: string, accountId: string | null, excludeSessionId: string) {
  const acct = accountId ? await one<any>("SELECT id, cash_balance, kind FROM trading_accounts WHERE id=$1", [accountId])
    : await one<any>("SELECT id, cash_balance, kind FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId]);
  if (!acct) return { acct: null, free: 0 };
  const others = await one<{ s: string }>(`SELECT COALESCE(sum(allocation_usd),0) AS s FROM trading_sessions WHERE user_id=$1 AND id<>$2 AND state = ANY($3::text[]) AND COALESCE(account_id, $4::uuid) = $4::uuid`,
    [userId, excludeSessionId, ACTIVE, acct.id]);
  return { acct, free: Number(acct.cash_balance) - (await reservedCash(acct.id)) - Number(others?.s ?? 0) };
}

export async function act(userId: string, id: string, action: SessionAction, expectedRevision: number, opts: { title?: string; reason?: string } = {}) {
  let s = await load(userId, id);
  if (action !== "clone" && s.revision !== expectedRevision) throw new HttpError(409, "This session changed in the meantime. Refresh and try again.");
  const why = opts.reason;
  switch (action) {
    case "rename": {
      if (!opts.title?.trim()) throw new HttpError(400, "Give the session a name");
      return transition(s, s.state, "rename", userId, why, { title: opts.title.trim().slice(0, 80) });
    }
    case "clone": {
      return createSession(userId, { title: `${s.title} (copy)`, strategyVersionId: s.strategy_version_id, allocationUsd: Number(s.allocation_usd), accountId: s.account_id });
    }
    case "start":
    case "resume": {
      if (!["DRAFT", "READY", "PAUSED", "STOPPED", "BLOCKED", "DEGRADED", "ERROR"].includes(s.state)) throw new HttpError(409, `Can't ${action} a ${s.state.toLowerCase()} session`);
      s = await transition(s, "VALIDATING", action, userId, why);
      const val = await validateRules(userId, s.rules);
      const cap = await capacity(userId, s.account_id, s.id);
      const errors = [...val.errors];
      if (cap.free + 1e-9 < Number(s.allocation_usd)) errors.push(`Not enough unallocated capital: $${Math.max(0, cap.free).toFixed(2)} free for a $${Number(s.allocation_usd).toFixed(2)} allocation`);
      if (errors.length) return transition(s, "BLOCKED", "validate", userId, errors.join("; "), { last_error: errors.join("; ").slice(0, 500) });
      s = await transition(s, "READY", "validate", userId, val.warnings.join("; ") || "checks passed", { last_error: null });
      try {
        if (s.bot_id) await setBotStatus(userId, s.bot_id, s.state === "PAUSED" || action === "resume" ? "resume" : "start");
        else {
          const cfg = await botConfigFor(s.title, s.rules, Number(s.allocation_usd), s.account_id);
          if (cfg) {
            const bot = await createBot(userId, cfg, "user");
            await setBotStatus(userId, bot.id, "start");
            s = await transition(s, "READY", "attach", userId, `executor ${bot.id}`, { bot_id: bot.id });
          }
        }
      } catch (e: any) {
        return transition(s, "ERROR", "start", userId, e.message, { last_error: String(e.message).slice(0, 500) });
      }
      return transition(s, "RUNNING", action, userId, s.rules.approvalPolicy === "observation" || s.rules.template === "scanner" ? "watch-only: no orders" : why);
    }
    case "pause": {
      if (!["RUNNING", "DEGRADED", "AWAITING_APPROVAL"].includes(s.state)) throw new HttpError(409, `Can't pause a ${s.state.toLowerCase()} session`);
      s = await transition(s, "PAUSING", "pause", userId, why);
      if (s.bot_id) await setBotStatus(userId, s.bot_id, "pause").catch(() => {});
      return transition(s, "PAUSED", "pause", userId, why);
    }
    case "stop": {
      if (["STOPPED", "ARCHIVED", "DRAFT"].includes(s.state)) throw new HttpError(409, `Session is already ${s.state.toLowerCase()}`);
      s = await transition(s, "STOPPING", "stop", userId, why);
      if (s.bot_id) {
        await setBotStatus(userId, s.bot_id, "stop").catch(() => {});
        // Open orders placed by this session are cancelled; filled positions stay in the account and remain visible.
        const open = await q<{ id: string }>("SELECT id FROM orders WHERE user_id=$1 AND source='bot' AND source_ref=$2 AND status IN ('validated','submitted','partially_filled','pending_approval')", [userId, s.bot_id]);
        for (const o of open) await cancel(o.id, userId, "Session stopped").catch(() => {});
      }
      return transition(s, "STOPPED", "stop", userId, why);
    }
    case "archive": {
      if (!["STOPPED", "DRAFT", "BLOCKED", "ERROR"].includes(s.state)) throw new HttpError(409, "Stop the session before archiving it");
      if (s.bot_id && (await one("SELECT 1 FROM orders WHERE user_id=$1 AND source='bot' AND source_ref=$2 AND status IN ('validated','submitted','partially_filled','pending_approval','unknown')", [userId, s.bot_id])))
        throw new HttpError(409, "This session still has open or unconfirmed orders. Resolve them first.");
      return transition(s, "ARCHIVED", "archive", userId, why);
    }
  }
}

/** Global controls: start all ready/paused sessions, pause all running ones. */
export async function actAll(userId: string, action: "start" | "pause") {
  const rows = await q<any>("SELECT id, revision, state FROM trading_sessions WHERE user_id=$1 AND state = ANY($2::text[])",
    [userId, action === "pause" ? ["RUNNING", "DEGRADED", "AWAITING_APPROVAL"] : ["DRAFT", "READY", "PAUSED"]]);
  const results: any[] = [];
  for (const r of rows) { try { results.push(await act(userId, r.id, action, r.revision)); } catch (e: any) { results.push({ id: r.id, error: e.message }); } }
  return results;
}

export async function listSessions(userId: string, includeArchived = false) {
  return q<any>(
    `SELECT s.*, v.version, v.summary, left(v.content_hash, 12) AS hash, st.name AS strategy_name, b.status AS bot_status, b.pnl_usd, b.trades_today, b.spent_today_usd,
            (SELECT row_to_json(e) FROM (SELECT action, to_state, reason, created_at FROM session_events WHERE session_id=s.id ORDER BY id DESC LIMIT 1) e) AS last_event,
            (SELECT count(*)::int FROM orders o WHERE o.source='bot' AND o.source_ref=s.bot_id::text AND o.status IN ('validated','submitted','partially_filled','pending_approval','unknown')) AS open_orders
       FROM trading_sessions s JOIN strategy_versions v ON v.id=s.strategy_version_id JOIN strategies st ON st.id=v.strategy_id LEFT JOIN trading_bots b ON b.id=s.bot_id
      WHERE s.user_id=$1 AND ($2 OR s.state <> 'ARCHIVED') ORDER BY s.pinned DESC, s.created_at DESC`, [userId, includeArchived]);
}

export async function sessionDetail(userId: string, id: string) {
  const s = await load(userId, id);
  const events = await q<any>("SELECT action, from_state, to_state, revision, reason, created_at FROM session_events WHERE session_id=$1 ORDER BY id DESC LIMIT 50", [id]);
  const orders = s.bot_id ? await q<any>(
    `SELECT o.id, o.side, o.status, o.status_reason, o.notional_usd, o.filled_quantity, o.avg_fill_price, o.created_at, a.symbol FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.source='bot' AND o.source_ref=$2 ORDER BY o.created_at DESC LIMIT 50`, [userId, s.bot_id]) : [];
  const logs = s.bot_id ? await q<any>("SELECT level, message, created_at FROM bot_activity_logs WHERE bot_id=$1 ORDER BY id DESC LIMIT 50", [s.bot_id]) : [];
  return { session: s, events, orders, logs };
}
