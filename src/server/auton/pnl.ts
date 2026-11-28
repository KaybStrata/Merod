import "@/lib/server-only-shim";
import { q } from "../db";

/**
 * Auton's own P&L: only trades by bots and agents Auton made or manages (separate from everything else).
 * For a time range (e.g. last 24 h) it returns the running line for that period, the period's P&L, and the previous
 * period of the same length for comparison (e.g. today vs yesterday).
 */
export async function autonPnl(userId: string, rangeSec: number | null) {
  const assets = await q<{ kind: string; ref_id: string }>("SELECT kind, ref_id FROM auton_assets WHERE user_id=$1 AND kind IN ('bot','managed_bot','agent')", [userId]);
  const botIds = assets.filter((a) => a.kind !== "agent").map((a) => a.ref_id), agentIds = assets.filter((a) => a.kind === "agent").map((a) => a.ref_id);
  const orders = botIds.length || agentIds.length ? await q<any>(
    `SELECT o.side, o.filled_quantity, o.avg_fill_price, o.realized_pnl, o.updated_at, o.asset_id, a.symbol, a.last_price
       FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.status IN ('filled','partially_filled')
        AND ((o.source='bot' AND o.source_ref = ANY($2::text[])) OR (o.source='agent' AND o.source_ref = ANY($3::text[])))
      ORDER BY o.updated_at`, [userId, botIds, agentIds]) : [];
  const now = Math.floor(Date.now() / 1000);
  const since = rangeSec ? now - rangeSec : 0, prevSince = rangeSec ? now - 2 * rangeSec : 0;
  let realized = 0, wins = 0, closed = 0, invested = 0;
  let pWins = 0, pClosed = 0, prevWins = 0, prevClosed = 0;
  const held = new Map<string, { symbol: string; qty: number; cost: number; price: number }>();
  const all: { time: number; value: number; trade?: any }[] = [];
  for (const o of orders) {
    const t = Math.floor(new Date(o.updated_at).getTime() / 1000);
    const qty = Number(o.filled_quantity ?? 0), px = Number(o.avg_fill_price ?? 0);
    const h = held.get(o.asset_id) ?? { symbol: o.symbol, qty: 0, cost: 0, price: Number(o.last_price ?? px) };
    let pnl: number | null = null;
    if (o.side === "buy") { h.qty += qty; h.cost += qty * px; invested += qty * px; }
    else {
      const avg = h.qty > 0 ? h.cost / h.qty : px, sold = Math.min(qty, h.qty);
      h.qty -= sold; h.cost -= sold * avg;
      pnl = Number(o.realized_pnl ?? 0) || (px - avg) * sold;
      realized += pnl; closed++; if (pnl > 0) wins++;
      if (!rangeSec || t >= since) { pClosed++; if (pnl > 0) pWins++; }
      else if (t >= prevSince) { prevClosed++; if (pnl > 0) prevWins++; }
    }
    held.set(o.asset_id, h);
    all.push({ time: t, value: realized, trade: { side: o.side, symbol: o.symbol, qty, price: px, usd: Math.round(qty * px * 100) / 100, pnl: pnl == null ? null : Math.round(pnl * 100) / 100 } });
  }
  // Realized P&L at the start of each window (orders before it).
  const realizedBefore = (ts: number) => { let v = 0; for (const p of all) { if (p.time >= ts) break; v = p.value; } return v; };
  const atSince = rangeSec ? realizedBefore(since) : 0, atPrev = rangeSec ? realizedBefore(prevSince) : 0;
  let unrealized = 0;
  const open = [...held.values()].filter((h) => h.qty > 1e-12).map((h) => { const u = h.qty * h.price - h.cost; unrealized += u; return { symbol: h.symbol, qty: h.qty, value: h.qty * h.price, unrealized: u }; });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const base = rangeSec ? atSince : 0;
  const points = all.filter((p) => !rangeSec || p.time >= since).map((p) => ({ ...p, value: r2(p.value - base) }));
  const period = r2(realized - base + unrealized);
  if (points.length || rangeSec) points.unshift({ time: rangeSec ? since : (all[0]?.time ?? now), value: 0 } as any);
  points.push({ time: now, value: period } as any);
  return {
    total: r2(realized + unrealized), realized: r2(realized), unrealized: r2(unrealized), invested: r2(invested), orders: orders.length, closed, wins, open,
    bots: botIds.length, agents: agentIds.length,
    period: { pnl: period, realized: r2(realized - base), closed: pClosed, wins: pWins },
    previous: rangeSec ? { pnl: r2(atSince - atPrev), closed: prevClosed, wins: prevWins } : null,
    points,
  };
}
