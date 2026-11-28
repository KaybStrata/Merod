import "@/lib/server-only-shim";
import { one, q } from "../db";

/**
 * A Talk tab = one conversation. Its scope is everything that conversation started:
 *   - orders placed from its prompts (orders.source='prompt', source_ref = a message in the conversation),
 *   - bots created from its plan cards or by Auton reporting to it, and their orders,
 *   - fleets/agents created from it, and their orders.
 * Each tab's Activity and P&L only count what's in its scope.
 */
export async function linkToConversation(userId: string, conversationId: string | null | undefined, kind: "bot" | "agent" | "fleet", refId: string | null | undefined) {
  if (!conversationId || !refId) return;
  await q("INSERT INTO conversation_links (user_id, conversation_id, kind, ref_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [userId, conversationId, kind, refId]).catch(() => {});
}

export async function tabScope(userId: string, conversationId: string) {
  const [msgs, links] = await Promise.all([
    q<any>("SELECT id FROM trading_prompts WHERE user_id=$1 AND conversation_id=$2", [userId, conversationId]),
    q<any>("SELECT kind, ref_id FROM conversation_links WHERE user_id=$1 AND conversation_id=$2", [userId, conversationId]).catch(() => []),
  ]);
  const fleetIds = links.filter((l) => l.kind === "fleet").map((l) => l.ref_id);
  const fleetAgents = fleetIds.length ? await q<any>("SELECT id FROM agents WHERE user_id=$1 AND fleet_id = ANY($2::uuid[])", [userId, fleetIds]).catch(() => []) : [];
  return {
    msgIds: msgs.map((m) => String(m.id)),
    botIds: links.filter((l) => l.kind === "bot").map((l) => String(l.ref_id)),
    agentIds: [...new Set([...links.filter((l) => l.kind === "agent").map((l) => String(l.ref_id)), ...fleetAgents.map((a) => String(a.id))])],
  };
}

/** SQL condition (on alias o) selecting the tab's orders; parameters start at $n. */
export function tabOrderCond(n: number) {
  return ` AND ((o.source='prompt' AND o.source_ref = ANY($${n}::text[])) OR (o.source='bot' AND o.source_ref = ANY($${n + 1}::text[])) OR (o.source='agent' AND o.source_ref = ANY($${n + 2}::text[])))`;
}

/** This tab's own P&L: realized from its closed trades + unrealized on what its trades still hold, and a running line. */
export async function tabPnl(userId: string, conversationId: string) {
  const s = await tabScope(userId, conversationId);
  const orders = await q<any>(
    `SELECT o.id, o.side, o.filled_quantity, o.avg_fill_price, o.realized_pnl, o.updated_at, o.asset_id, a.symbol, a.last_price
       FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.status IN ('filled','partially_filled') ${tabOrderCond(2)} ORDER BY o.updated_at`,
    [userId, s.msgIds, s.botIds, s.agentIds]);
  let realized = 0, wins = 0, closed = 0, invested = 0;
  const held = new Map<string, { symbol: string; qty: number; cost: number; price: number }>();
  const points: { time: number; value: number }[] = [];
  for (const o of orders) {
    const qty = Number(o.filled_quantity ?? 0), px = Number(o.avg_fill_price ?? 0);
    const h = held.get(o.asset_id) ?? { symbol: o.symbol, qty: 0, cost: 0, price: Number(o.last_price ?? px) };
    if (o.side === "buy") { h.qty += qty; h.cost += qty * px; invested += qty * px; }
    else {
      const avg = h.qty > 0 ? h.cost / h.qty : px;
      const sold = Math.min(qty, h.qty);
      h.qty -= sold; h.cost -= sold * avg;
      const pnl = Number(o.realized_pnl ?? 0) || (px - avg) * sold;
      realized += pnl; closed++; if (pnl > 0) wins++;
    }
    held.set(o.asset_id, h);
    points.push({ time: Math.floor(new Date(o.updated_at).getTime() / 1000), value: Math.round(realized * 100) / 100 });
  }
  let unrealized = 0;
  const open = [...held.values()].filter((h) => h.qty > 1e-12).map((h) => { const u = h.qty * h.price - h.cost; unrealized += u; return { symbol: h.symbol, qty: h.qty, value: h.qty * h.price, unrealized: u }; });
  const total = realized + unrealized;
  const now = Math.floor(Date.now() / 1000);
  if (points.length) points.push({ time: now, value: Math.round(total * 100) / 100 });
  return {
    realized: Math.round(realized * 100) / 100, unrealized: Math.round(unrealized * 100) / 100, total: Math.round(total * 100) / 100,
    invested: Math.round(invested * 100) / 100, orders: orders.length, closed, wins, open, points,
    bots: s.botIds.length, agents: s.agentIds.length, prompts: s.msgIds.length,
  };
}

/** Title of a conversation, for labels. */
export async function conversationTitle(userId: string, conversationId: string) {
  return (await one<any>("SELECT title FROM ai_conversations WHERE id=$1 AND user_id=$2", [conversationId, userId]).catch(() => null))?.title ?? "This tab";
}
