import { requireUser, isAdminRole } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";
import { getSettings } from "@/server/auto/engine";

/**
 * One real-time stream of everything thinking, deciding and executing for you on Merod:
 * agents (thoughts/analysis/decisions/executions), bots (observations/triggers/orders/results), auto trading + Modo,
 * your orders and fills, copy/mimic trades, and Merod itself (platform trades, worker/system events for admins).
 * Newest first; `since` (ms) returns only newer items for live polling.
 */
type Item = { id: string; at: string; source: "agent" | "bot" | "auto" | "modo" | "order" | "copy" | "merod"; kind: "thought" | "analysis" | "decision" | "execution" | "warning" | "state"; actor: string; title: string; body?: string; link?: string; side?: "buy" | "sell"; pnl?: number; pnlPct?: number };
const BOT_KIND: Record<string, Item["kind"]> = { observation: "analysis", trigger: "decision", instruction: "decision", order: "execution", result: "execution", warning: "warning", error: "warning", control: "state" };
const AGENT_KIND: Record<string, Item["kind"]> = { thought: "thought", analysis: "analysis", decision: "decision", execution: "execution", warning: "warning", approval: "decision", training: "analysis", state: "state", message: "analysis", system: "state" };

export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const since = sp.get("since") ? new Date(Number(sp.get("since"))) : new Date(Date.now() - 24 * 3600_000);
  const lim = Math.min(300, Number(sp.get("limit") ?? 150));
  const owner = u.role === "super_admin";
  const [agents, bots, orders, copies, platform, system] = await Promise.all([
    q<any>(`SELECT e.id, e.created_at, e.kind, e.title, e.body, e.agent_id, a.name FROM agent_events e LEFT JOIN agents a ON a.id=e.agent_id WHERE e.user_id=$1 AND e.created_at > $2 ORDER BY e.id DESC LIMIT $3`, [u.id, since, lim]),
    q<any>(`SELECT l.id, l.created_at, l.level, l.message, b.id AS bot_id, b.name FROM bot_activity_logs l JOIN trading_bots b ON b.id=l.bot_id WHERE b.user_id=$1 AND l.created_at > $2 ORDER BY l.id DESC LIMIT $3`, [u.id, since, lim]),
    q<any>(`SELECT o.id, o.updated_at, o.side, o.status, o.source, o.is_paper, o.filled_quantity, o.avg_fill_price, o.notional_usd, o.status_reason, o.realized_pnl, a.symbol, a.id AS asset_id
              FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 AND o.updated_at > $2 ORDER BY o.updated_at DESC LIMIT $3`, [u.id, since, lim]),
    q<any>(`SELECT e.id, e.created_at, e.side, e.symbol, e.status, e.reason, e.venue, f.label FROM copy_trade_events e JOIN copy_follows f ON f.id=e.follow_id WHERE f.follower_id=$1 AND e.created_at > $2 ORDER BY e.id DESC LIMIT $3`, [u.id, since, lim]),
    q<any>(`SELECT x.id, x.executed_at, o.side, x.quantity, x.price, o.is_paper, o.source, a.symbol, a.id AS asset_id FROM executions x JOIN orders o ON o.id=x.order_id JOIN assets a ON a.id=o.asset_id
             WHERE x.executed_at > $1 AND o.user_id <> $2 ORDER BY x.executed_at DESC LIMIT 60`, [since, u.id]),
    isAdminRole(u.role) ? q<any>(`SELECT id, created_at, source, level, message FROM system_events WHERE created_at > $1 ORDER BY id DESC LIMIT 40`, [since]) : Promise.resolve([] as any[]),
  ]);
  const items: Item[] = [];
  for (const e of agents) items.push({ id: `ag${e.id}`, at: e.created_at, source: "agent", kind: AGENT_KIND[e.kind] ?? "state", actor: e.name ?? "Agent", title: e.title, body: e.body || undefined, link: e.agent_id ? `/agents/${e.agent_id}` : "/agents" });
  for (const l of bots) items.push({ id: `bt${l.id}`, at: l.created_at, source: "bot", kind: BOT_KIND[l.level] ?? "state", actor: l.name, title: l.message, link: `/bots/${l.bot_id}` });
  for (const o of orders) {
    const filled = Number(o.filled_quantity) > 0;
    const what = filled ? `${o.side === "buy" ? "Bought" : "Sold"} ${Number(o.filled_quantity).toPrecision(5)} ${o.symbol} @ $${Number(o.avg_fill_price).toPrecision(6)}` : `${o.side === "buy" ? "Buy" : "Sell"} ${o.symbol}${o.notional_usd ? ` $${Number(o.notional_usd).toFixed(2)}` : ""}: ${String(o.status).replace("_", " ")}`;
    const pnl = o.side === "sell" && filled && Number(o.realized_pnl) !== 0 ? Number(o.realized_pnl) : undefined;
    const cost = pnl !== undefined ? Number(o.filled_quantity) * Number(o.avg_fill_price) - pnl : 0;
    items.push({ id: `or${o.id}`, at: o.updated_at, source: "order", side: o.side, pnl, pnlPct: pnl !== undefined && cost > 0 ? (pnl / cost) * 100 : undefined, kind: filled ? "execution" : ["rejected", "failed"].includes(o.status) ? "warning" : "decision",
      actor: `${o.is_paper ? "Paper" : "Real money"} · ${o.source}`, title: what, body: o.status_reason || undefined, link: `/terminal/${o.asset_id}` });
  }
  for (const c of copies) items.push({ id: `cp${c.id}`, at: c.created_at, source: "copy", side: c.side, kind: c.status === "copied" ? "execution" : c.status === "failed" ? "warning" : "decision", actor: `Mimic · ${c.label}`, title: `${c.label} ${c.side === "buy" ? "bought" : "sold"} ${c.symbol ?? "a token"} on ${c.venue ?? "?"} → ${c.status.replace("_", " ")}`, body: c.reason || undefined, link: "/mimic" });
  for (const p of platform) items.push({ id: `pl${p.id}`, at: p.executed_at, source: "merod", side: p.side, kind: "execution", actor: `Merod trader${p.is_paper ? " (paper)" : ""}`, title: `${p.side === "buy" ? "Bought" : "Sold"} ${Number(p.quantity).toPrecision(4)} ${p.symbol} @ $${Number(p.price).toPrecision(6)} · via ${p.source}`, link: `/terminal/${p.asset_id}` });
  for (const s of system) items.push({ id: `sy${s.id}`, at: s.created_at, source: "merod", kind: s.level === "info" ? "state" : "warning", actor: `Merod · ${s.source}`, title: s.message });
  if (owner) {
    const auto = await q<any>(`SELECT t.id, t.created_at, t.closed_at, t.symbol, t.mode, t.origin, t.confidence, t.return_pct, t.explain_during, eo.realized_pnl AS exit_pnl FROM auto_trades t LEFT JOIN orders eo ON eo.id=t.exit_order_id WHERE t.user_id=$1 AND greatest(t.created_at, COALESCE(t.closed_at, t.created_at)) > $2 ORDER BY t.created_at DESC LIMIT 60`, [u.id, since]);
    for (const t of auto) {
      const who = t.origin === "modo" ? "modo" : "auto";
      items.push({ id: `at${t.id}`, at: t.created_at, source: who, side: "buy", kind: t.mode === "real" && t.explain_during ? "execution" : "decision", actor: who === "modo" ? "Modo Autopilot" : "Auto trading",
        title: t.mode === "real" && t.explain_during ? `${t.symbol}: ${String(t.explain_during).split(".")[0]}` : `Decided to buy ${t.symbol}${t.mode === "theory" ? " (theoretical)" : ""} · ${Math.round(Number(t.confidence) * 100)}% confidence`, link: "/auto" });
      if (t.closed_at && new Date(t.closed_at) > since) items.push({ id: `ac${t.id}`, at: t.closed_at, source: who, side: "sell", pnl: t.exit_pnl != null && Number(t.exit_pnl) !== 0 ? Number(t.exit_pnl) : undefined, pnlPct: t.return_pct != null ? Number(t.return_pct) : undefined, kind: "execution", actor: who === "modo" ? "Modo Autopilot" : "Auto trading", title: `Closed ${t.symbol} ${Number(t.return_pct) >= 0 ? "+" : ""}${Number(t.return_pct).toFixed(2)}%${t.mode === "theory" ? " (theoretical)" : ""}`, link: "/auto" });
    }
    const s = await getSettings(u.id);
    for (const [i, th] of (s.modo_thoughts ?? []).slice(-80).entries()) {
      const at = new Date(th.at);
      if (at > since) items.push({ id: `mt${at.getTime()}${i}`, at: at.toISOString(), source: "modo", kind: th.kind === "idea" ? "decision" : "thought", actor: "Modo", title: th.text, link: "/auto" });
    }
  }
  for (const it of items) it.at = new Date(it.at as any).toISOString();
  items.sort((a, b) => b.at.localeCompare(a.at));
  return ok({ items: items.slice(0, lim), now: Date.now() });
});
