import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { publish } from "../realtime";
import { HttpError } from "../errors";
import { getStrategy } from "../bots/strategies";
import { record } from "../training/trainer";

/**
 * MEROD AI LEARNING
 * Turns trade outcomes into explainable learnings. Each learning carries its evidence, a sample size,
 * a confidence level, and (optionally) a concrete proposed update the user can apply with "Update".
 * Applied updates are recorded in training_adjustments, so they can be reverted.
 * Learnings never loosen risk limits and never touch permissions.
 */
type Confidence = "low" | "medium" | "high";
interface Learning {
  key: string; category: string; title: string; insight: string; evidence: Record<string, unknown>;
  confidence: Confidence; sampleSize: number; proposedUpdate: ProposedUpdate | null;
}
export type ProposedUpdate =
  | { type: "bot_params"; botId: string; botName: string; changes: Record<string, number | boolean | null>; label: string }
  | { type: "bot_pause"; botId: string; botName: string; label: string }
  | { type: "prompt_defaults"; changes: { default_stop_loss_pct?: number; max_prompt_order_usd?: number }; label: string }
  | { type: "shortcut_scale"; shortcutId: string; shortcutName: string; factor: number; label: string }
  | { type: "risk_tighten"; changes: { max_order_usd?: number; max_slippage_bps?: number; min_liquidity_usd?: number }; label: string };

const conf = (n: number): Confidence => (n >= 10 ? "high" : n >= 4 ? "medium" : "low");
const r1 = (n: number) => Math.round(n * 10) / 10;
const usd = (n: number) => `$${Math.abs(n).toFixed(2)}`;

/* ───────────── Personal learnings ───────────── */
async function personal(userId: string): Promise<Learning[]> {
  const out: Learning[] = [];
  const closes = await q<any>(
    `SELECT o.source, o.source_ref, o.asset_id, a.symbol, o.realized_pnl, o.filled_quantity*o.avg_fill_price AS notional, extract(hour from o.updated_at)::int AS hr
       FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 AND o.side='sell' AND o.status='filled' AND o.updated_at > now() - interval '30 days'`, [userId]);

  // 1) Performance by trading method
  const bySource = new Map<string, any[]>();
  for (const c of closes) bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]);
  for (const [source, list] of bySource) {
    if (list.length < 2) continue;
    const wins = list.filter((c) => Number(c.realized_pnl) > 0).length;
    const pnl = list.reduce((s, c) => s + Number(c.realized_pnl), 0);
    const avgLossPct = (() => { const l = list.filter((c) => Number(c.realized_pnl) < 0); return l.length ? l.reduce((s, c) => s + Math.abs(Number(c.realized_pnl)) / Math.max(Number(c.notional), 1) * 100, 0) / l.length : 0; })();
    const winRate = (wins / list.length) * 100;
    let update: ProposedUpdate | null = null;
    if (pnl < 0 && source === "prompt" && avgLossPct > 0) update = { type: "prompt_defaults", changes: { default_stop_loss_pct: r1(Math.min(Math.max(avgLossPct * 0.6, 2), 15)) }, label: `Auto-attach a ${r1(Math.min(Math.max(avgLossPct * 0.6, 2), 15))}% stop-loss to prompt buys` };
    out.push({
      key: `source:${source}`, category: "performance", confidence: conf(list.length), sampleSize: list.length, proposedUpdate: update,
      title: `${source[0].toUpperCase()}${source.slice(1)} trades: ${r1(winRate)}% win rate, ${pnl >= 0 ? "+" : "−"}${usd(pnl)}`,
      insight: pnl >= 0 ? `Your ${source} trades are net profitable over the last 30 days.` : `Your ${source} trades are losing money on balance (avg losing trade −${r1(avgLossPct)}%).${update ? " Protective stops would have capped these losses." : ""}`,
      evidence: { closes: list.length, wins, losses: list.length - wins, realizedPnl: r1(pnl), avgLossPct: r1(avgLossPct) },
    });
  }

  // 2) Assets that cost you the most
  const byAsset = new Map<string, any[]>();
  for (const c of closes) byAsset.set(c.asset_id, [...(byAsset.get(c.asset_id) ?? []), c]);
  const worst = [...byAsset.values()].map((l) => ({ l, pnl: l.reduce((s, c) => s + Number(c.realized_pnl), 0) })).filter((x) => x.pnl < 0 && x.l.length >= 2).sort((a, b) => a.pnl - b.pnl)[0];
  if (worst) {
    const sym = worst.l[0].symbol;
    const risk = await one<any>("SELECT max_order_usd FROM risk_settings WHERE user_id=$1", [userId]);
    const avgSize = worst.l.reduce((s: number, c: any) => s + Number(c.notional), 0) / worst.l.length;
    const cap = Math.round(Math.min(Number(risk?.max_order_usd ?? 1000), avgSize * 0.75));
    out.push({
      key: `asset:${worst.l[0].asset_id}`, category: "asset", confidence: conf(worst.l.length), sampleSize: worst.l.length,
      title: `${sym} is your biggest drag (−${usd(worst.pnl)})`, insight: `${worst.l.length} closed ${sym} trades lost money in total. Smaller position sizes reduce the damage while you reassess.`,
      evidence: { symbol: sym, closes: worst.l.length, realizedPnl: r1(worst.pnl), avgTradeUsd: r1(avgSize) },
      proposedUpdate: cap < Number(risk?.max_order_usd ?? Infinity) ? { type: "risk_tighten", changes: { max_order_usd: cap }, label: `Lower max order size to $${cap}` } : null,
    });
  }

  // 3) Execution problems (engine rejections)
  const rej = await q<any>(`SELECT status_reason, count(*)::int AS n FROM orders WHERE user_id=$1 AND status='rejected' AND created_at > now() - interval '7 days' GROUP BY status_reason ORDER BY n DESC LIMIT 5`, [userId]);
  const total = rej.reduce((s, r) => s + r.n, 0);
  if (total >= 2) {
    const top = rej[0].status_reason ?? "";
    let update: ProposedUpdate | null = null;
    if (/liquidity/i.test(top)) update = { type: "risk_tighten", changes: { min_liquidity_usd: 100000 }, label: "Require at least $100k liquidity before buying" };
    out.push({
      key: "execution:rejections", category: "execution", confidence: conf(total), sampleSize: total, proposedUpdate: update,
      title: `${total} orders were blocked by safety checks this week`,
      insight: `Most common reason: “${String(top).slice(0, 120)}”. ${/stale/i.test(top) ? "Stale prices mean the data feed paused — orders were correctly refused." : /limit/i.test(top) ? "Orders were larger than your limits; size them down or adjust limits deliberately in Settings." : "Adjusting how orders are sized avoids these rejections."}`,
      evidence: { reasons: rej.map((r) => ({ reason: String(r.status_reason).slice(0, 120), count: r.n })) },
    });
  }

  // 4) Better parameters for each dip-loop bot (replay on recent history)
  const bots = await q<any>("SELECT * FROM trading_bots WHERE user_id=$1 AND strategy_id='dip_rebound_loop' AND status IN ('running','paused')", [userId]);
  for (const b of bots) {
    const assetId = b.asset_ids?.[0];
    if (!assetId) continue;
    const bars = (await q<any>("SELECT close FROM price_bars WHERE asset_id=$1 AND timeframe='1h' ORDER BY ts DESC LIMIT 336", [assetId])).reverse().map((x) => Number(x.close));
    if (bars.length < 100) continue;
    const cur = replay(bars, Number(b.params.dip_pct), Number(b.params.take_profit_pct), b.params.stop_loss_pct ? Number(b.params.stop_loss_pct) : null);
    let best = { dip: Number(b.params.dip_pct), tp: Number(b.params.take_profit_pct), ...cur };
    for (const dip of [1, 1.5, 2, 3, 4, 5, 6, 8]) for (const tp of [1.5, 2, 3, 4, 5, 6, 8, 10]) {
      const r = replay(bars, dip, tp, b.params.stop_loss_pct ? Number(b.params.stop_loss_pct) : null);
      if (r.trades >= 3 && r.ret > best.ret) best = { dip, tp, ...r };
    }
    if (best.ret - cur.ret >= 2 && (best.dip !== Number(b.params.dip_pct) || best.tp !== Number(b.params.take_profit_pct))) {
      out.push({
        key: `bot:${b.id}:params`, category: "strategy", confidence: conf(best.trades), sampleSize: best.trades,
        title: `“${b.name}” would have done better with ${best.dip}% dip / +${best.tp}% target`,
        insight: `Replaying the last ${bars.length} hours: current settings ${r1(cur.ret)}% (${cur.trades} trades) vs ${r1(best.ret)}% (${best.trades} trades, ${best.wins}W/${best.losses}L). Past replays can overfit — treat as a hint, not a promise.`,
        evidence: { hours: bars.length, current: { dip: b.params.dip_pct, tp: b.params.take_profit_pct, returnPct: r1(cur.ret), trades: cur.trades }, best: { dip: best.dip, tp: best.tp, returnPct: r1(best.ret), trades: best.trades } },
        proposedUpdate: { type: "bot_params", botId: b.id, botName: b.name, changes: { dip_pct: best.dip, take_profit_pct: best.tp }, label: `Set ${b.name} to ${best.dip}% dip / +${best.tp}%` },
      });
    }
    if ((b.loss_streak ?? 0) >= 2 && b.status === "running") out.push({
      key: `bot:${b.id}:streak`, category: "strategy", confidence: "medium", sampleSize: b.loss_streak,
      title: `“${b.name}” has lost ${b.loss_streak} cycles in a row`, insight: "Consider pausing it while conditions are unfavourable.",
      evidence: { lossStreak: b.loss_streak }, proposedUpdate: { type: "bot_pause", botId: b.id, botName: b.name, label: `Pause ${b.name}` },
    });
  }

  // 5) Shortcuts that lose money
  const sc = await q<any>(
    `SELECT s.id, s.name, COALESCE(SUM(x.realized_pnl),0) AS pnl, count(x.*)::int AS n FROM trading_shortcuts s
       JOIN orders b ON b.source='shortcut' AND b.source_ref=s.id::text AND b.side='buy' AND b.status='filled'
       JOIN orders x ON x.user_id=s.user_id AND x.asset_id=b.asset_id AND x.side='sell' AND x.status='filled' AND x.updated_at > b.created_at
      WHERE s.user_id=$1 GROUP BY s.id, s.name HAVING COALESCE(SUM(x.realized_pnl),0) < 0`, [userId]);
  for (const s of sc) out.push({
    key: `shortcut:${s.id}`, category: "performance", confidence: conf(s.n), sampleSize: s.n,
    title: `Shortcut “${s.name}” is net negative (−${usd(Number(s.pnl))})`, insight: "Trades opened with this button closed at a loss overall. Halving its size limits the impact while you reconsider it.",
    evidence: { closes: s.n, realizedPnl: r1(Number(s.pnl)) }, proposedUpdate: { type: "shortcut_scale", shortcutId: s.id, shortcutName: s.name, factor: 0.5, label: `Halve “${s.name}” buy amounts` },
  });

  // 6) Timing
  if (closes.length >= 8) {
    const hours = new Map<number, { n: number; pnl: number }>();
    for (const c of closes) { const h = hours.get(c.hr) ?? { n: 0, pnl: 0 }; h.n++; h.pnl += Number(c.realized_pnl); hours.set(c.hr, h); }
    const ranked = [...hours.entries()].filter(([, v]) => v.n >= 2).sort((a, b) => a[1].pnl - b[1].pnl);
    if (ranked.length >= 2) out.push({
      key: "timing:hours", category: "timing", confidence: conf(closes.length), sampleSize: closes.length, proposedUpdate: null,
      title: `Best hour ${ranked.at(-1)![0]}:00 UTC, worst ${ranked[0][0]}:00 UTC`,
      insight: `Your exits around ${ranked[0][0]}:00 UTC lost ${usd(ranked[0][1].pnl)} in total, while ${ranked.at(-1)![0]}:00 UTC made ${usd(ranked.at(-1)![1].pnl)}.`,
      evidence: { byHour: ranked.map(([h, v]) => ({ hourUtc: h, closes: v.n, pnl: r1(v.pnl) })) },
    });
  }
  return out;
}

/** Dip-loop replay used for parameter learning (fees/slippage approximated at 0.3% round trip). */
function replay(bars: number[], dip: number, tp: number, sl: number | null) {
  let ref = bars[0], holding = false, entry = 0, eq = 1, trades = 0, wins = 0, losses = 0;
  for (const p of bars) {
    if (!holding) { ref = Math.max(ref, p); if ((ref - p) / ref * 100 >= dip) { holding = true; entry = p; trades++; } }
    else {
      const g = (p - entry) / entry * 100;
      if (g >= tp || (sl && g <= -sl)) { eq *= 1 + g / 100 - 0.003; holding = false; ref = p; g >= 0 ? wins++ : losses++; trades++; }
    }
  }
  if (holding) eq *= bars.at(-1)! / entry;
  return { ret: (eq - 1) * 100, trades, wins, losses };
}

/* ───────────── Platform learnings (anonymized; k-anonymity ≥ 3 traders) ───────────── */
async function platform(): Promise<Learning[]> {
  const rows = await q<any>(
    `SELECT source, count(*)::int AS n, count(DISTINCT user_id)::int AS traders, count(*) FILTER (WHERE realized_pnl > 0)::int AS wins, COALESCE(SUM(realized_pnl),0) AS pnl
       FROM orders WHERE side='sell' AND status='filled' AND updated_at > now() - interval '30 days' GROUP BY source HAVING count(DISTINCT user_id) >= 3`);
  return rows.filter((r) => r.n >= 5).map((r) => ({
    key: `platform:source:${r.source}`, category: "platform", confidence: conf(r.n), sampleSize: r.n, proposedUpdate: null,
    title: `Across Merod: ${r.source} trades win ${r1(r.wins / r.n * 100)}% of the time`,
    insight: `${r.n} closed ${r.source} trades by ${r.traders} traders in the last 30 days (paper and live combined).`,
    evidence: { closes: r.n, traders: r.traders, winRatePct: r1(r.wins / r.n * 100) },
  }));
}

async function upsert(userId: string | null, scope: "personal" | "platform", items: Learning[]) {
  let fresh = 0;
  const keys = items.map((i) => i.key);
  for (const l of items) {
    const existing = await one<any>("SELECT id, proposed_update FROM ai_learnings WHERE user_id IS NOT DISTINCT FROM $1 AND key=$2 AND status='new'", [userId, l.key]);
    if (existing) {
      await q("UPDATE ai_learnings SET title=$2, insight=$3, evidence=$4, confidence=$5, sample_size=$6, proposed_update=$7, updated_at=now() WHERE id=$1",
        [existing.id, l.title, l.insight, JSON.stringify(l.evidence), l.confidence, l.sampleSize, l.proposedUpdate ? JSON.stringify(l.proposedUpdate) : null]);
    } else {
      // Skip re-proposing something the user just applied/dismissed with the same update.
      const recent = await one<any>(`SELECT 1 FROM ai_learnings WHERE user_id IS NOT DISTINCT FROM $1 AND key=$2 AND status IN ('applied','dismissed') AND updated_at > now() - interval '6 hours'`, [userId, l.key]);
      if (recent) continue;
      await q(`INSERT INTO ai_learnings (user_id, scope, key, category, title, insight, evidence, confidence, sample_size, proposed_update) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [userId, scope, l.key, l.category, l.title, l.insight, JSON.stringify(l.evidence), l.confidence, l.sampleSize, l.proposedUpdate ? JSON.stringify(l.proposedUpdate) : null]);
      fresh++;
    }
  }
  // Learnings whose signal disappeared are superseded.
  await q(`UPDATE ai_learnings SET status='superseded', updated_at=now() WHERE user_id IS NOT DISTINCT FROM $1 AND scope=$2 AND status='new' AND NOT (key = ANY($3))`, [userId, scope, keys]);
  return fresh;
}

export async function refreshLearnings(userId: string) {
  const fresh = await upsert(userId, "personal", await personal(userId));
  await publish(`user:${userId}`, "learning", { fresh, ts: Date.now() });
  return fresh;
}

/** Worker loop: users with recent trading activity + platform aggregates. */
export async function runLearning() {
  const p = await upsert(null, "platform", await platform());
  if (p) await publish("activity", "learning", { scope: "platform", fresh: p });
  const users = await q<{ user_id: string }>("SELECT DISTINCT user_id FROM orders WHERE updated_at > now() - interval '3 days'");
  for (const u of users) await refreshLearnings(u.user_id);
  return users.length;
}

/* ───────────── Apply ("Update") ───────────── */
export async function applyLearning(userId: string, id: string) {
  const l = await one<any>("SELECT * FROM ai_learnings WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!l) throw new HttpError(404, "Learning not found");
  if (l.status !== "new") throw new HttpError(409, `Already ${l.status}`);
  const u = l.proposed_update as ProposedUpdate | null;
  if (!u) throw new HttpError(400, "This learning is informational — nothing to update");
  let adj: any = null;
  const why = `AI Learning: ${l.title}`;
  switch (u.type) {
    case "bot_params": {
      const b = await one<any>("SELECT * FROM trading_bots WHERE id=$1 AND user_id=$2", [u.botId, userId]);
      if (!b) throw new HttpError(404, "Bot not found");
      const allowed = new Set((getStrategy(b.strategy_id)?.params ?? []).map((p) => p.key));
      const changes = Object.fromEntries(Object.entries(u.changes).filter(([k]) => allowed.has(k)));
      const next = { ...b.params, ...changes };
      await q("UPDATE trading_bots SET params=$2, updated_at=now() WHERE id=$1", [b.id, JSON.stringify(next)]);
      await q("INSERT INTO bot_activity_logs (bot_id, level, message, data) VALUES ($1,'control',$2,$3)", [b.id, `${why} — applied by user`, JSON.stringify({ before: b.params, after: next })]);
      adj = await record(userId, "bot", b.id, b.name, "ai_learning_params", why, l.evidence, { params: b.params, max_position_usd: b.max_position_usd }, { params: next, max_position_usd: b.max_position_usd });
      break;
    }
    case "bot_pause": {
      const b = await one<any>("UPDATE trading_bots SET status='paused' WHERE id=$1 AND user_id=$2 AND status='running' RETURNING id, name", [u.botId, userId]);
      if (!b) throw new HttpError(409, "Bot is not running");
      adj = await record(userId, "bot", b.id, b.name, "ai_learning_pause", why, l.evidence, { status: "running" }, { status: "paused" });
      break;
    }
    case "prompt_defaults": {
      const cur = await one<any>("SELECT default_stop_loss_pct, max_prompt_order_usd FROM prompt_trading_defaults WHERE user_id=$1", [userId]);
      const before = { default_stop_loss_pct: cur?.default_stop_loss_pct ?? null, max_prompt_order_usd: cur?.max_prompt_order_usd ?? null };
      const after = { ...before, ...u.changes };
      await q(`INSERT INTO prompt_trading_defaults (user_id, default_stop_loss_pct, max_prompt_order_usd) VALUES ($1,$2,$3)
               ON CONFLICT (user_id) DO UPDATE SET default_stop_loss_pct=$2, max_prompt_order_usd=$3, updated_at=now()`, [userId, after.default_stop_loss_pct, after.max_prompt_order_usd]);
      adj = await record(userId, "prompt_defaults", userId, "Prompt-to-trade defaults", "ai_learning_prompt", why, l.evidence, before, after);
      break;
    }
    case "shortcut_scale": {
      const s = await one<any>("SELECT * FROM trading_shortcuts WHERE id=$1 AND user_id=$2", [u.shortcutId, userId]);
      if (!s) throw new HttpError(404, "Shortcut not found");
      const factor = Math.min(Math.max(u.factor, 0.1), 1); // only ever scales DOWN
      const actions = (s.actions as any[]).map((a) => (["buy_usd", "buy_qty"].includes(a.type) && a.amount ? { ...a, amount: Math.round(a.amount * factor * 1e6) / 1e6 } : a));
      await q("UPDATE trading_shortcuts SET actions=$2 WHERE id=$1", [s.id, JSON.stringify(actions)]);
      adj = await record(userId, "shortcut", s.id, s.name, "ai_learning_scale", why, l.evidence, { actions: s.actions }, { actions });
      break;
    }
    case "risk_tighten": {
      const r = await one<any>("SELECT max_order_usd, max_slippage_bps, min_liquidity_usd FROM risk_settings WHERE user_id=$1", [userId]);
      const before: any = {}, after: any = {};
      // Tighten only: lower max order/slippage, raise min liquidity.
      if (u.changes.max_order_usd != null && u.changes.max_order_usd < Number(r.max_order_usd)) { before.max_order_usd = Number(r.max_order_usd); after.max_order_usd = u.changes.max_order_usd; }
      if (u.changes.max_slippage_bps != null && u.changes.max_slippage_bps < Number(r.max_slippage_bps)) { before.max_slippage_bps = Number(r.max_slippage_bps); after.max_slippage_bps = u.changes.max_slippage_bps; }
      if (u.changes.min_liquidity_usd != null && u.changes.min_liquidity_usd > Number(r.min_liquidity_usd)) { before.min_liquidity_usd = Number(r.min_liquidity_usd); after.min_liquidity_usd = u.changes.min_liquidity_usd; }
      if (!Object.keys(after).length) throw new HttpError(409, "Your limits are already at least this strict");
      for (const [k, v] of Object.entries(after)) await q(`UPDATE risk_settings SET ${k}=$2, updated_at=now() WHERE user_id=$1`, [userId, v]);
      adj = await record(userId, "risk_settings", userId, "Risk limits", "ai_learning_risk", why, l.evidence, before, after);
      break;
    }
  }
  await q("UPDATE ai_learnings SET status='applied', applied_at=now(), updated_at=now(), adjustment_id=$2 WHERE id=$1", [id, adj?.id ?? null]);
  await audit({ actorType: "user", actorId: userId, userId, action: "learning.applied", target: id, data: { type: u.type } });
  return { adjustmentId: adj?.id ?? null };
}

export async function dismissLearning(userId: string, id: string) {
  const r = await one("UPDATE ai_learnings SET status='dismissed', updated_at=now() WHERE id=$1 AND user_id=$2 AND status='new' RETURNING id", [id, userId]);
  if (!r) throw new HttpError(404, "Learning not found");
}
