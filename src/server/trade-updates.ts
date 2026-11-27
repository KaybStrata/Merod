import "@/lib/server-only-shim";
import { one, q } from "./db";
import { HttpError } from "./errors";

/**
 * Talk "Update" / "Record": read recent trading (every filled order, grouped by the bot, agent or source that placed it,
 * and by coin), work out what's working and what isn't, and propose concrete changes:
 *   - turn off a bot/agent that keeps losing,
 *   - tighten a stop-loss when losses run much bigger than wins,
 *   - give a consistent winner a bigger trade size,
 *   - avoid a coin that keeps losing (a 7-day point that every bot and agent obeys).
 * Proposals are applied only when the user presses Apply, or automatically in Record mode when the user turned on
 * "auto-apply safe changes" (only risk-reducing changes are ever auto-applied: pausing, tighter stops, avoiding a coin).
 */
export type Action =
  | { type: "pause"; kind: "bot" | "agent"; id: string; name: string }
  | { type: "edit"; kind: "bot" | "agent"; id: string; name: string; edit: { stopLossPct?: number; takeProfitPct?: number; amountUsd?: number } }
  | { type: "point"; name: string; text: string };
export type Decision = { title: string; why: string; safe: boolean; action: Action };
type ActorStats = { key: string; kind: string; id: string | null; name: string; buys: number; sells: number; closed: number; wins: number; losses: number; net: number; volume: number; winPct: number[]; lossPct: number[]; coins: Record<string, number> };

const r2 = (n: number) => Math.round(n * 100) / 100;
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const SOURCE_NAME: Record<string, string> = { manual: "Your manual trades", prompt: "Trades from prompts", shortcut: "Shortcuts", copy: "Mimic / copy trades", auto: "Auto trading", conditional: "Conditional orders", system: "System", signal: "Signal bots" };

export async function analyze(userId: string, hours = 24) {
  const h = Math.min(24 * 90, Math.max(1, hours));
  const rows = await q<any>(
    `SELECT o.source, o.source_ref, o.side, o.realized_pnl, o.filled_quantity, o.avg_fill_price, o.notional_usd, o.is_paper, a.symbol
       FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.status IN ('filled','partially_filled') AND o.updated_at > now() - make_interval(hours => $2::int)`, [userId, Math.ceil(h)]);
  const botIds = [...new Set(rows.filter((r) => r.source === "bot" && r.source_ref).map((r) => r.source_ref))];
  const agentIds = [...new Set(rows.filter((r) => r.source === "agent" && r.source_ref).map((r) => r.source_ref))];
  const bots = new Map((botIds.length ? await q<any>("SELECT id, name, status, strategy_id, params FROM trading_bots WHERE user_id=$1 AND id::text = ANY($2)", [userId, botIds]) : []).map((b) => [b.id, b]));
  const agents = new Map((agentIds.length ? await q<any>("SELECT id, name, status, strategy FROM agents WHERE user_id=$1 AND id::text = ANY($2)", [userId, agentIds]) : []).map((a) => [a.id, a]));

  const actors = new Map<string, ActorStats>();
  const coins = new Map<string, { symbol: string; net: number; closed: number; losses: number; wins: number }>();
  let net = 0, volume = 0, closed = 0, wins = 0;
  for (const r of rows) {
    const kind = (r.source === "bot" || r.source === "agent") && r.source_ref ? r.source : "source";
    const key = kind === "source" ? `source:${r.source}` : `${kind}:${r.source_ref}`;
    const name = kind === "bot" ? bots.get(r.source_ref)?.name ?? "Deleted bot" : kind === "agent" ? agents.get(r.source_ref)?.name ?? "Deleted agent" : SOURCE_NAME[r.source] ?? r.source;
    const s = actors.get(key) ?? actors.set(key, { key, kind, id: kind === "source" ? null : r.source_ref, name, buys: 0, sells: 0, closed: 0, wins: 0, losses: 0, net: 0, volume: 0, winPct: [], lossPct: [], coins: {} }).get(key)!;
    const value = Number(r.filled_quantity ?? 0) * Number(r.avg_fill_price ?? 0) || Number(r.notional_usd ?? 0);
    s.volume += value; volume += value;
    const c = coins.get(r.symbol) ?? coins.set(r.symbol, { symbol: r.symbol, net: 0, closed: 0, losses: 0, wins: 0 }).get(r.symbol)!;
    if (r.side === "buy") { s.buys++; continue; }
    s.sells++;
    const pnl = Number(r.realized_pnl ?? 0);
    const cost = value - pnl;
    const pct = cost > 0 ? (pnl / cost) * 100 : 0;
    s.closed++; closed++; c.closed++;
    s.net += pnl; net += pnl; c.net += pnl; s.coins[r.symbol] = (s.coins[r.symbol] ?? 0) + pnl;
    if (pnl > 0) { s.wins++; wins++; c.wins++; s.winPct.push(pct); } else if (pnl < 0) { s.losses++; c.losses++; s.lossPct.push(-pct); }
  }

  const decisions: Decision[] = [];
  for (const s of actors.values()) {
    if (s.kind === "source" || !s.id) continue;
    const kind = s.kind as "bot" | "agent";
    const rec = kind === "bot" ? bots.get(s.id) : agents.get(s.id);
    if (!rec) continue;
    const winRate = s.closed ? s.wins / s.closed : 0;
    const aw = avg(s.winPct), al = avg(s.lossPct);
    const running = ["running", "queued"].includes(rec.status);
    const curSl = Number(kind === "bot" ? rec.params?.stop_loss_pct ?? 0 : rec.strategy?.stopLossPct ?? 0);
    const curAmt = Number(kind === "bot" ? rec.params?.amount_usd ?? 0 : rec.strategy?.tradeUsd ?? 0);
    if (running && s.closed >= 3 && s.net < 0 && winRate < 0.4) {
      decisions.push({ title: `Turn off ${s.name}`, why: `${s.losses} of ${s.closed} closed trades lost (win rate ${Math.round(winRate * 100)}%), net ${s.net < 0 ? "-" : ""}$${Math.abs(r2(s.net))}. Pausing it keeps its open positions but stops new buys.`, safe: true, action: { type: "pause", kind, id: s.id, name: s.name } });
      continue;
    }
    if (s.losses >= 2 && al >= 2 && al > aw * 1.5) {
      const sl = Math.max(1, Math.round(Math.max(aw * 1.2, al * 0.6) * 10) / 10);
      if (!curSl || curSl > sl) decisions.push({ title: `Tighter stop-loss for ${s.name}: −${sl}%`, why: `Its losses average −${r2(al)}% while wins average +${r2(aw)}%. ${curSl ? `Current stop-loss −${curSl}%.` : "It has no stop-loss now."} Cutting losers at −${sl}% keeps one loss from erasing several wins.`, safe: true, action: { type: "edit", kind, id: s.id, name: s.name, edit: { stopLossPct: sl } } });
    }
    if (s.closed >= 3 && winRate >= 0.65 && s.net > 0 && curAmt > 0) {
      const amt = Math.round(curAmt * 1.25 * 100) / 100;
      decisions.push({ title: `Give ${s.name} more per trade: $${curAmt} → $${amt}`, why: `It won ${s.wins} of ${s.closed} closed trades (${Math.round(winRate * 100)}%), net +$${r2(s.net)}. A 25% larger size lets the winner do more; this adds risk, so it's never applied automatically.`, safe: false, action: { type: "edit", kind, id: s.id, name: s.name, edit: { amountUsd: amt } } });
    }
  }
  for (const c of coins.values()) {
    if (c.losses >= 3 && c.net < 0 && c.wins <= c.losses / 3) {
      decisions.push({ title: `Avoid ${c.symbol} for 7 days`, why: `${c.losses} losing trades vs ${c.wins} winning on ${c.symbol}, net -$${Math.abs(r2(c.net))}. Adds a point so no bot, agent or prompt buys it for a week.`, safe: true, action: { type: "point", name: `Avoid ${c.symbol}`, text: `Never buy ${c.symbol} for 7 days (it kept losing).` } });
    }
  }

  // Idle running bots (only meaningful over a day or more).
  const idle = h >= 24 ? await q<any>(`SELECT name FROM trading_bots b WHERE user_id=$1 AND status='running' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id=b.user_id AND o.source='bot' AND o.source_ref=b.id::text AND o.created_at > now() - make_interval(hours => $2::int)) LIMIT 10`, [userId, Math.ceil(h)]).catch(() => []) : [];

  const by = [...actors.values()].sort((a, b) => b.net - a.net).map((s) => ({ name: s.name, kind: s.kind, buys: s.buys, sells: s.sells, closed: s.closed, wins: s.wins, losses: s.losses, net: r2(s.net), winRate: s.closed ? Math.round((s.wins / s.closed) * 100) : null, avgWinPct: r2(avg(s.winPct)), avgLossPct: r2(avg(s.lossPct)) }));
  const coinList = [...coins.values()].sort((a, b) => b.net - a.net).map((c) => ({ ...c, net: r2(c.net) }));
  const stats = {
    hours: h, orders: rows.length, closed, wins, net: r2(net), volume: r2(volume), winRate: closed ? Math.round((wins / closed) * 100) : null,
    best: by[0] && by[0].net > 0 ? by[0] : null, worst: by.length && by[by.length - 1].net < 0 ? by[by.length - 1] : null,
    actors: by.slice(0, 40), coins: coinList.slice(0, 40), idle: idle.map((x: any) => x.name),
  };
  return { stats, decisions, summary: summarize(stats, decisions) };
}

export function summarize(s: any, d: Decision[]) {
  const span = s.hours >= 48 ? `${Math.round(s.hours / 24)} days` : `${s.hours} hour${s.hours === 1 ? "" : "s"}`;
  if (!s.orders) return `No filled trades in the last ${span}, so there's nothing to learn from yet.${s.idle?.length ? ` Running but idle: ${s.idle.join(", ")}.` : ""}`;
  const parts = [`Last ${span}: ${s.orders} filled orders, ${s.closed} closed trade${s.closed === 1 ? "" : "s"}${s.winRate != null ? ` (${s.winRate}% won)` : ""}, realized ${s.net >= 0 ? "+" : "-"}$${Math.abs(s.net).toFixed(2)}.`];
  if (s.best) parts.push(`Best: ${s.best.name} ${s.best.net >= 0 ? "+" : ""}$${s.best.net}.`);
  if (s.worst) parts.push(`Worst: ${s.worst.name} -$${Math.abs(s.worst.net)}.`);
  if (s.idle?.length) parts.push(`Running but no trades: ${s.idle.slice(0, 4).join(", ")}${s.idle.length > 4 ? "…" : ""}.`);
  parts.push(d.length ? `${d.length} suggested change${d.length === 1 ? "" : "s"} below.` : "Nothing needs changing right now.");
  return parts.join(" ");
}

export async function createUpdate(userId: string, hours: number, source: "manual" | "record" = "manual") {
  const a = await analyze(userId, hours);
  const row = await one<any>("INSERT INTO trade_updates (user_id, source, hours, stats, decisions) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [userId, source, a.stats.hours, JSON.stringify({ ...a.stats, summary: a.summary }), JSON.stringify(a.decisions)]);
  return row;
}

export async function listUpdates(userId: string, limit = 10) {
  return q<any>("SELECT * FROM trade_updates WHERE user_id=$1 ORDER BY id DESC LIMIT $2", [userId, limit]);
}

/** Apply one proposed decision (index) of an update. Returns a one-line result, stored on the update. */
export async function applyDecision(userId: string, updateId: number, index: number, isOwner: boolean) {
  const u = await one<any>("SELECT * FROM trade_updates WHERE id=$1 AND user_id=$2", [updateId, userId]);
  if (!u) throw new HttpError(404, "Update not found");
  const d: Decision | undefined = u.decisions?.[index];
  if (!d) throw new HttpError(404, "That suggestion doesn't exist");
  if (u.applied?.[index]) return { line: u.applied[index], already: true };
  const line = await runAction(userId, d.action, isOwner);
  await q("UPDATE trade_updates SET applied = applied || jsonb_build_object($3::text, $4::text) WHERE id=$1 AND user_id=$2", [updateId, userId, String(index), line]);
  return { line, already: false };
}

async function runAction(userId: string, a: Action, isOwner: boolean): Promise<string> {
  if (a.type === "pause") {
    const { runControl } = await import("./ai/control");
    const row = a.kind === "bot" ? await one<any>("SELECT status FROM trading_bots WHERE id=$1 AND user_id=$2", [a.id, userId]) : await one<any>("SELECT status FROM agents WHERE id=$1 AND user_id=$2", [a.id, userId]);
    if (!row) return `${a.name} no longer exists.`;
    return (await runControl(userId, "pause", [{ kind: a.kind, id: a.id, name: a.name, status: row.status }], isOwner)).join(" ").replace(/^•\s*/, "");
  }
  if (a.type === "edit") {
    const { applyEdits } = await import("./ai/bulk-edit");
    return (await applyEdits(userId, [{ kind: a.kind, id: a.id, name: a.name }], a.edit)).join(" ").replace(/^•\s*/, "") || `${a.name}: unchanged.`;
  }
  const { createSkill } = await import("./skills");
  const r = await createSkill(userId, a.name, a.text, "point");
  return `Point added: “${r.skill.instructions}”${r.skill.expires_at ? ` (until ${new Date(r.skill.expires_at).toUTCString().slice(0, 22)})` : ""}.`;
}

/* ───────── Record mode ───────── */
export async function getRecording(userId: string) {
  return one<any>("SELECT * FROM trade_recording WHERE user_id=$1", [userId]);
}
export async function setRecording(userId: string, o: { active: boolean; everyMin?: number; autoApply?: boolean }) {
  const every = Math.max(5, Math.min(24 * 60, Math.round(o.everyMin ?? 60)));
  return one<any>(
    `INSERT INTO trade_recording (user_id, active, every_min, auto_apply, started_at, next_run_at) VALUES ($1,$2,$3,$4,now(), now() + make_interval(mins => $3))
     ON CONFLICT (user_id) DO UPDATE SET active=$2, every_min=$3, auto_apply=COALESCE($4, trade_recording.auto_apply),
       started_at = CASE WHEN $2 AND NOT trade_recording.active THEN now() ELSE trade_recording.started_at END,
       next_run_at = CASE WHEN $2 THEN now() + make_interval(mins => $3) ELSE trade_recording.next_run_at END
     RETURNING *`, [userId, o.active, every, o.autoApply ?? false]);
}

/** Worker: every due recording produces an update (skipped when nothing traded), auto-applies safe changes if allowed, notifies. */
export async function runDueRecordings() {
  const due = await q<any>("UPDATE trade_recording SET next_run_at = now() + make_interval(mins => every_min), last_run_at=now() WHERE active AND next_run_at <= now() RETURNING *");
  const { notify } = await import("./engine/engine");
  for (const r of due) {
    try {
      const hours = Math.max(1, Math.ceil(Math.max(r.every_min / 60, 6)));
      const a = await analyze(r.user_id, hours);
      if (!a.stats.orders && !a.decisions.length) continue;
      const row = await one<any>("INSERT INTO trade_updates (user_id, source, hours, stats, decisions) VALUES ($1,'record',$2,$3,$4) RETURNING id",
        [r.user_id, a.stats.hours, JSON.stringify({ ...a.stats, summary: a.summary }), JSON.stringify(a.decisions)]);
      const applied: string[] = [];
      if (r.auto_apply) {
        const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [r.user_id]))?.role;
        for (const [i, d] of a.decisions.entries()) if (d.safe) applied.push((await applyDecision(r.user_id, row!.id, i, role === "super_admin")).line);
      }
      const waiting = a.decisions.length - applied.length;
      await notify(r.user_id, "update", `Recording: ${a.decisions.length ? `${a.decisions.length} suggestion${a.decisions.length === 1 ? "" : "s"}` : "trading update"}`,
        `${a.summary}${applied.length ? ` Auto-applied ${applied.length} safe change${applied.length === 1 ? "" : "s"}.` : ""}${waiting ? ` ${waiting} waiting for you in Talk → Update.` : ""}`, "/talk?update=1").catch(() => {});
    } catch (e: any) { console.error("[recording]", r.user_id, e?.message); }
  }
  return due.length;
}
