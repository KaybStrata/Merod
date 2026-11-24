import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { publish } from "../realtime";
import { notify } from "../engine/engine";

/**
 * MEROD AUTO-TRAINING
 * A transparent, rule-based tuner (not a black-box model) that corrects bots, shortcuts and
 * prompt-trade defaults after mistakes (engine rejections), wrong trades, or losses.
 *
 * Hard guarantees:
 *  • Only REDUCES risk vs the original configuration: sizes/budgets/caps never go above the original;
 *    slippage is never widened; protective stops are only added or tightened.
 *  • Never changes trading permissions, feature flags or risk settings.
 *  • Every change is recorded (before/after/evidence), notified, and revertible.
 *  • Switchable: per user (auto_training_settings.enabled + scopes) with per-bot/per-shortcut override.
 *  • Learns from realized results; it does not and cannot guarantee profit.
 */

export interface TrainingSettings { enabled: boolean; scope_bots: boolean; scope_shortcuts: boolean; scope_prompts: boolean; pause_after_losses: number; max_adjustments_per_day: number }
export const DEFAULT_SETTINGS: TrainingSettings = { enabled: true, scope_bots: true, scope_shortcuts: true, scope_prompts: true, pause_after_losses: 3, max_adjustments_per_day: 10 };

export async function getTrainingSettings(userId: string): Promise<TrainingSettings> {
  return (await one<TrainingSettings>("SELECT enabled, scope_bots, scope_shortcuts, scope_prompts, pause_after_losses, max_adjustments_per_day FROM auto_training_settings WHERE user_id=$1", [userId])) ?? DEFAULT_SETTINGS;
}
export const effective = (override: string | null | undefined, userOn: boolean) => (override === "on" ? true : override === "off" ? false : userOn);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

async function adjustmentsToday(userId: string) {
  return (await one<{ n: number }>("SELECT count(*)::int AS n FROM training_adjustments WHERE user_id=$1 AND status='applied' AND created_at >= date_trunc('day', now())", [userId]))?.n ?? 0;
}

export async function record(userId: string, targetType: "bot" | "shortcut" | "prompt_defaults" | "risk_settings", targetId: string, targetName: string, rule: string, reason: string, evidence: unknown, before: unknown, after: unknown) {
  const row = await one<any>(
    `INSERT INTO training_adjustments (user_id, target_type, target_id, target_name, rule, reason, evidence, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId, targetType, targetId, targetName, rule, reason, JSON.stringify(evidence), JSON.stringify(before), JSON.stringify(after)]);
  await audit({ actorType: "system", actorId: "auto_training", userId, action: "training.adjust", target: `${targetType}:${targetId}`, data: { rule, reason, before, after } });
  await notify(userId, "bot", `Auto-training adjusted “${targetName}”`, reason, targetType === "bot" ? `/bots/${targetId}` : "/training");
  await publish(`user:${userId}`, "training", { id: row.id, targetType, targetId, targetName, rule, reason });
  return row;
}

/* ───────────────────────── Bots ───────────────────────── */
interface BotEvidence { losses: { orderId: string; pnl: number; pct: number }[]; wins: number; rejections: { reason: string }[]; streak: number }

async function botEvidence(b: any): Promise<BotEvidence> {
  const since = b.training_cursor ?? b.created_at;
  const sells = await q<any>(
    `SELECT id, realized_pnl, filled_quantity, avg_fill_price, updated_at FROM orders
      WHERE source='bot' AND source_ref=$1 AND side='sell' AND status='filled' AND updated_at > $2 ORDER BY updated_at`, [String(b.id), since]);
  const rejections = await q<any>(
    `SELECT status_reason AS reason FROM orders WHERE source='bot' AND source_ref=$1 AND status IN ('rejected','failed') AND updated_at > $2`, [String(b.id), since]);
  let streak = b.loss_streak ?? 0, wins = 0;
  const losses: BotEvidence["losses"] = [];
  for (const s of sells) {
    const pnl = Number(s.realized_pnl);
    const notional = Number(s.filled_quantity) * Number(s.avg_fill_price);
    if (pnl < 0) { streak++; losses.push({ orderId: s.id, pnl, pct: notional ? (pnl / (notional - pnl)) * 100 : 0 }); }
    else { wins++; streak = 0; }
  }
  return { losses, wins, rejections, streak };
}

/** Pure rule set: returns new params (risk-reducing only) or null. Exported for tests. */
export function tuneBotParams(strategyId: string, params: any, original: any, ev: BotEvidence): { params: any; rules: string[]; reasons: string[] } | null {
  const p = { ...params }; const rules: string[] = []; const reasons: string[] = [];
  const o = original ?? params;
  const lost = ev.losses.length > 0;
  const worst = lost ? Math.min(...ev.losses.map((l) => l.pct)) : 0;
  const shrink = (key: string, factor: number, floorFrac = 0.25) => {
    if (p[key] == null || o[key] == null) return;
    const next = round(clamp(Number(p[key]) * factor, Number(o[key]) * floorFrac, Number(o[key])));
    if (next < Number(p[key])) { p[key] = next; rules.push(`reduce_${key}`); }
  };
  if (lost) {
    switch (strategyId) {
      case "dip_rebound_loop": {
        const dip = round(clamp(Number(p.dip_pct) + 0.5, Number(o.dip_pct), Math.min(Number(o.dip_pct) * 2.5, 20)));
        if (dip > Number(p.dip_pct)) { p.dip_pct = dip; rules.push("wider_dip_entry"); reasons.push(`wait for a deeper ${dip}% dip before re-entering`); }
        const stop = round(clamp(Math.abs(worst) * 0.8, 1.5, Number(o.stop_loss_pct ?? 15)));
        if (p.stop_loss_pct == null || stop < Number(p.stop_loss_pct)) { p.stop_loss_pct = stop; rules.push("tighter_stop_loss"); reasons.push(`${p.stop_loss_pct}% stop-loss to cap losing cycles`); }
        break;
      }
      case "technical_indicator": {
        const slow = Math.min(Number(p.slow) + 2, 100);
        if (slow > Number(p.slow)) { p.slow = slow; rules.push("slower_trend_filter"); reasons.push(`slow SMA lengthened to ${slow} bars to filter false crosses`); }
        break;
      }
      case "stop_loss_take_profit": {
        const sl = round(clamp(Number(p.stop_loss_pct) * 0.8, 1.5, Number(o.stop_loss_pct)));
        if (sl < Number(p.stop_loss_pct)) { p.stop_loss_pct = sl; rules.push("tighter_stop_loss"); reasons.push(`stop-loss tightened to ${sl}%`); }
        break;
      }
    }
    const before = p.amount_usd;
    shrink("amount_usd", 0.8);
    if (p.amount_usd !== before) reasons.push(`trade size reduced to $${p.amount_usd}`);
  }
  // Mistakes: engine rejections tell us the bot asked for something that can't execute safely.
  const reasonsText = ev.rejections.map((r) => r.reason ?? "").join(" | ");
  if (/slippage|liquidity|limit \$|Daily spend|daily limit|Need \$/i.test(reasonsText)) {
    const before = p.amount_usd;
    shrink("amount_usd", 0.75);
    if (p.amount_usd !== before) reasons.push(`orders were rejected (${ev.rejections.length}× — ${reasonsText.slice(0, 80)}); size reduced to $${p.amount_usd}`);
  }
  return rules.length ? { params: p, rules, reasons } : null;
}

async function trainBot(b: any, s: TrainingSettings) {
  const ev = await botEvidence(b);
  const now = new Date().toISOString();
  const original = b.original_config ?? { params: b.params, max_position_usd: b.max_position_usd, max_daily_spend_usd: b.max_daily_spend_usd };
  if (!b.original_config) await q("UPDATE trading_bots SET original_config=$2 WHERE id=$1", [b.id, JSON.stringify(original)]);
  const tuned = tuneBotParams(b.strategy_id, b.params, original.params, ev);
  if (tuned && (await adjustmentsToday(b.user_id)) < s.max_adjustments_per_day) {
    const newMaxPos = tuned.params.amount_usd ? Math.min(Number(b.max_position_usd), Math.max(Number(tuned.params.amount_usd), 1)) : Number(b.max_position_usd);
    await q("UPDATE trading_bots SET params=$2, max_position_usd=$3, updated_at=now() WHERE id=$1", [b.id, JSON.stringify(tuned.params), newMaxPos]);
    const reason = `After ${ev.losses.length ? `${ev.losses.length} losing trade(s)` : "rejected orders"}: ${tuned.reasons.join("; ")}.`;
    await q("INSERT INTO bot_activity_logs (bot_id, level, message, data) VALUES ($1,'control',$2,$3)", [b.id, `Auto-training: ${reason}`, JSON.stringify({ before: b.params, after: tuned.params })]);
    await record(b.user_id, "bot", b.id, b.name, tuned.rules.join("+"), reason, ev, { params: b.params, max_position_usd: b.max_position_usd }, { params: tuned.params, max_position_usd: newMaxPos });
  }
  if (ev.streak >= s.pause_after_losses && b.status === "running") {
    await q("UPDATE trading_bots SET status='paused' WHERE id=$1", [b.id]);
    const reason = `${ev.streak} consecutive losing trades — paused for your review.`;
    await q("INSERT INTO bot_activity_logs (bot_id, level, message) VALUES ($1,'control',$2)", [b.id, `Auto-training: ${reason}`]);
    await record(b.user_id, "bot", b.id, b.name, "pause_on_loss_streak", reason, { streak: ev.streak }, { status: "running" }, { status: "paused" });
  }
  await q("UPDATE trading_bots SET training_cursor=$2, loss_streak=$3 WHERE id=$1", [b.id, now, ev.streak >= s.pause_after_losses ? 0 : ev.streak]);
}

/* ───────────────────────── Shortcuts ───────────────────────── */
async function trainShortcut(sc: any, s: TrainingSettings) {
  const since = sc.training_cursor ?? sc.created_at;
  const now = new Date().toISOString();
  const rejected = await q<any>("SELECT status_reason AS reason FROM orders WHERE source='shortcut' AND source_ref=$1 AND status IN ('rejected','failed') AND updated_at > $2", [String(sc.id), since]);
  // Losses: sells of assets this shortcut bought, realized at a loss after the shortcut's buys.
  const losses = await q<any>(
    `SELECT s.realized_pnl FROM orders s WHERE s.user_id=$1 AND s.side='sell' AND s.status='filled' AND s.realized_pnl < 0 AND s.updated_at > $2
        AND EXISTS (SELECT 1 FROM orders b WHERE b.source='shortcut' AND b.source_ref=$3 AND b.side='buy' AND b.status='filled' AND b.asset_id=s.asset_id AND b.created_at < s.updated_at)`,
    [sc.user_id, since, String(sc.id)]);
  await q("UPDATE trading_shortcuts SET training_cursor=$2 WHERE id=$1", [sc.id, now]);
  if (!rejected.length && !losses.length) return;
  if ((await adjustmentsToday(sc.user_id)) >= s.max_adjustments_per_day) return;
  const original = sc.original_config ?? { actions: sc.actions };
  if (!sc.original_config) await q("UPDATE trading_shortcuts SET original_config=$2 WHERE id=$1", [sc.id, JSON.stringify(original)]);
  const actions = (sc.actions as any[]).map((a) => ({ ...a }));
  const reasons: string[] = [], rules: string[] = [];
  actions.forEach((a, i) => {
    const orig = original.actions?.[i];
    if ((a.type === "buy_usd" || a.type === "buy_qty") && a.amount && orig?.amount) {
      const next = round(clamp(a.amount * 0.8, orig.amount * 0.25, orig.amount), a.type === "buy_qty" ? 6 : 2);
      if (next < a.amount) { reasons.push(`${a.type === "buy_usd" ? "$" : ""}${a.amount} → ${a.type === "buy_usd" ? "$" : ""}${next}`); a.amount = next; rules.push("reduce_size"); }
    }
  });
  const hasBuy = actions.some((a) => a.type === "buy_usd" || a.type === "buy_qty");
  if (losses.length && hasBuy && !actions.some((a) => a.type === "set_stop_loss_pct") && actions.length < 8) {
    actions.push({ type: "set_stop_loss_pct", amount: 5, orderType: "market" });
    rules.push("add_stop_loss"); reasons.push("added a 5% protective stop-loss after each buy");
  }
  if (!rules.length) return;
  await q("UPDATE trading_shortcuts SET actions=$2 WHERE id=$1", [sc.id, JSON.stringify(actions)]);
  const why = `After ${losses.length ? `${losses.length} losing trade(s)` : ""}${losses.length && rejected.length ? " and " : ""}${rejected.length ? `${rejected.length} rejected order(s)` : ""}: ${reasons.join("; ")}.`;
  await record(sc.user_id, "shortcut", sc.id, sc.name, rules.join("+"), why, { losses: losses.length, rejected: rejected.map((r) => r.reason) }, { actions: sc.actions }, { actions });
}

/* ───────────────────────── Prompt-trade defaults ───────────────────────── */
async function trainPrompts(userId: string, s: TrainingSettings) {
  const cur = await one<any>("SELECT * FROM prompt_trading_defaults WHERE user_id=$1", [userId]);
  const since = cur?.training_cursor ?? new Date(0).toISOString();
  const now = new Date().toISOString();
  // Losing exits on assets that were bought via prompts.
  const losses = await q<any>(
    `SELECT s.realized_pnl, s.filled_quantity, s.avg_fill_price FROM orders s WHERE s.user_id=$1 AND s.side='sell' AND s.status='filled' AND s.realized_pnl < 0 AND s.updated_at > $2
        AND EXISTS (SELECT 1 FROM orders b WHERE b.user_id=$1 AND b.source='prompt' AND b.side='buy' AND b.status='filled' AND b.asset_id=s.asset_id)`, [userId, since]);
  const rejected = await q<any>("SELECT status_reason AS reason, notional_usd FROM orders WHERE user_id=$1 AND source='prompt' AND status='rejected' AND updated_at > $2", [userId, since]);
  await q(`INSERT INTO prompt_trading_defaults (user_id, training_cursor) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET training_cursor=$2`, [userId, now]);
  if (!losses.length && !rejected.length) return;
  if ((await adjustmentsToday(userId)) >= s.max_adjustments_per_day) return;
  const before = { default_stop_loss_pct: cur?.default_stop_loss_pct ?? null, max_prompt_order_usd: cur?.max_prompt_order_usd ?? null };
  const after = { ...before };
  const reasons: string[] = [], rules: string[] = [];
  if (losses.length) {
    const pcts = losses.map((l) => { const n = Number(l.filled_quantity) * Number(l.avg_fill_price); return Math.abs(Number(l.realized_pnl) / (n - Number(l.realized_pnl))) * 100; });
    const avgLoss = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    const stop = round(clamp(avgLoss * 0.6, 2, 15));
    if (after.default_stop_loss_pct == null || stop < Number(after.default_stop_loss_pct)) { after.default_stop_loss_pct = stop; rules.push("auto_stop_loss"); reasons.push(`future prompt buys get an automatic ${stop}% stop-loss (avg loss was ${avgLoss.toFixed(1)}%)`); }
  }
  const sizeRejects = rejected.filter((r) => /limit \$|Daily spend|Need \$|slippage|liquidity/i.test(r.reason ?? ""));
  if (sizeRejects.length) {
    const typical = Math.min(...sizeRejects.map((r) => Number(r.notional_usd) || Infinity));
    if (Number.isFinite(typical)) {
      const cap = round(typical * 0.75);
      if (after.max_prompt_order_usd == null || cap < Number(after.max_prompt_order_usd)) { after.max_prompt_order_usd = cap; rules.push("prompt_size_cap"); reasons.push(`prompt orders above $${cap} will ask you first (previous ones were rejected)`); }
    }
  }
  if (!rules.length) return;
  await q("UPDATE prompt_trading_defaults SET default_stop_loss_pct=$2, max_prompt_order_usd=$3, learned_from=$4, updated_at=now() WHERE user_id=$1",
    [userId, after.default_stop_loss_pct, after.max_prompt_order_usd, JSON.stringify({ losses: losses.length, rejected: rejected.length })]);
  await record(userId, "prompt_defaults", userId, "Prompt-to-trade defaults", rules.join("+"), `${reasons.join("; ")}.`, { losses: losses.length, rejected: rejected.length }, before, after);
}

/** Worker loop entry point. */
export async function runTraining() {
  const users = await q<{ user_id: string }>(
    `SELECT DISTINCT u.id AS user_id FROM users u LEFT JOIN auto_training_settings s ON s.user_id=u.id
      WHERE u.status='active' AND (COALESCE(s.enabled, true) OR EXISTS (SELECT 1 FROM trading_bots b WHERE b.user_id=u.id AND b.auto_training='on')
                                     OR EXISTS (SELECT 1 FROM trading_shortcuts t WHERE t.user_id=u.id AND t.auto_training='on'))
        AND EXISTS (SELECT 1 FROM orders o WHERE o.user_id=u.id AND o.updated_at > now() - interval '2 days')`);
  let n = 0;
  for (const { user_id } of users) {
    const s = await getTrainingSettings(user_id);
    const bots = await q<any>("SELECT * FROM trading_bots WHERE user_id=$1 AND status IN ('running','paused')", [user_id]);
    for (const b of bots) if (effective(b.auto_training, s.enabled && s.scope_bots)) { await trainBot(b, s); n++; }
    const scs = await q<any>("SELECT * FROM trading_shortcuts WHERE user_id=$1", [user_id]);
    for (const sc of scs) if (effective(sc.auto_training, s.enabled && s.scope_shortcuts)) { await trainShortcut(sc, s); n++; }
    if (s.enabled && s.scope_prompts) { await trainPrompts(user_id, s); n++; }
  }
  return n;
}

/** Undo one adjustment (restores the recorded "before" state). */
export async function revertAdjustment(userId: string, id: string) {
  const a = await one<any>("SELECT * FROM training_adjustments WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!a || a.status !== "applied") throw new Error("Adjustment not found or already reverted");
  if (a.target_type === "bot") {
    if (a.before.params) await q("UPDATE trading_bots SET params=$3, max_position_usd=$4 WHERE id=$1 AND user_id=$2", [a.target_id, userId, JSON.stringify(a.before.params), a.before.max_position_usd]);
    if (a.before.status) await q("UPDATE trading_bots SET status=$3 WHERE id=$1 AND user_id=$2 AND status='paused'", [a.target_id, userId, a.before.status]);
    await q("INSERT INTO bot_activity_logs (bot_id, level, message) VALUES ($1,'control',$2)", [a.target_id, `Auto-training change reverted by user (${a.rule})`]);
  } else if (a.target_type === "shortcut") {
    await q("UPDATE trading_shortcuts SET actions=$3 WHERE id=$1 AND user_id=$2", [a.target_id, userId, JSON.stringify(a.before.actions)]);
  } else if (a.target_type === "risk_settings") {
    const cols = Object.keys(a.before).filter((k) => ["max_order_usd", "max_slippage_bps", "min_liquidity_usd"].includes(k));
    for (const c of cols) await q(`UPDATE risk_settings SET ${c}=$2, updated_at=now() WHERE user_id=$1`, [userId, a.before[c]]);
  } else {
    await q("UPDATE prompt_trading_defaults SET default_stop_loss_pct=$2, max_prompt_order_usd=$3 WHERE user_id=$1", [userId, a.before.default_stop_loss_pct, a.before.max_prompt_order_usd]);
  }
  await q("UPDATE training_adjustments SET status='reverted', reverted_at=now() WHERE id=$1", [id]);
  await audit({ actorType: "user", actorId: userId, userId, action: "training.revert", target: id });
}

/** Protective defaults applied to new prompt trades (only when auto-training is on). */
export async function promptDefaults(userId: string) {
  const s = await getTrainingSettings(userId);
  if (!s.enabled || !s.scope_prompts) return null;
  return one<{ default_stop_loss_pct: number | null; max_prompt_order_usd: number | null }>("SELECT default_stop_loss_pct, max_prompt_order_usd FROM prompt_trading_defaults WHERE user_id=$1", [userId]);
}
