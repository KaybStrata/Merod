import "@/lib/server-only-shim";
import { one, q } from "./db";

/**
 * P&L for any group of trades (all trades, bots, auto trading, Modo, Mimic, Auton, a Talk tab, or a mix):
 * the running line for a time range, that period's P&L, and the previous period of the same length to compare.
 * Realized P&L is average-cost per coin; open positions are marked at the last price.
 */
export type Scope = "trades" | "bot" | "auto" | "modo" | "copy" | "auton" | "prompt" | "manual";
export const SCOPES: Scope[] = ["trades", "bot", "auto", "modo", "copy", "auton", "prompt", "manual"];

export function pnlFromOrders(orders: any[], rangeSec: number | null) {
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
  const realizedBefore = (ts: number) => { let v = 0; for (const p of all) { if (p.time >= ts) break; v = p.value; } return v; };
  const atSince = rangeSec ? realizedBefore(since) : 0, atPrev = rangeSec ? realizedBefore(prevSince) : 0;
  let unrealized = 0;
  const open = [...held.values()].filter((h) => h.qty > 1e-12).map((h) => { const u = h.qty * h.price - h.cost; unrealized += u; return { symbol: h.symbol, qty: h.qty, value: h.qty * h.price, unrealized: u }; });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const base = rangeSec ? atSince : 0;
  const points: { time: number; value: number; trade?: any }[] = all.filter((p) => !rangeSec || p.time >= since).map((p) => ({ ...p, value: r2(p.value - base) }));
  const period = r2(realized - base + unrealized);
  // Always a line, even with no trades yet: it starts at 0 at the left edge.
  points.unshift({ time: rangeSec ? since : (all[0]?.time ?? now - 3600), value: 0 });
  points.push({ time: now, value: period });
  return {
    total: r2(realized + unrealized), realized: r2(realized), unrealized: r2(unrealized), invested: r2(invested), orders: orders.length, closed, wins, open,
    period: { pnl: period, realized: r2(realized - base), closed: pClosed, wins: pWins },
    previous: rangeSec ? { pnl: r2(atSince - atPrev), closed: prevClosed, wins: prevWins } : null,
    points,
  };
}

/** SQL (on alias o) for a scope; extra parameters start at $n. */
async function scopeCond(userId: string, scope: Scope, n: number): Promise<{ sql: string; params: unknown[]; bots?: number; agents?: number }> {
  switch (scope) {
    case "bot": return { sql: " AND o.source IN ('bot','agent')", params: [] };
    case "auto": return { sql: " AND o.source='auto' AND o.idempotency_key NOT LIKE 'modo-%'", params: [] };
    case "modo": return { sql: " AND o.source='auto' AND o.idempotency_key LIKE 'modo-%'", params: [] };
    case "copy": return { sql: " AND o.source='copy'", params: [] };
    case "prompt": return { sql: " AND o.source='prompt'", params: [] };
    case "manual": return { sql: " AND o.source='manual'", params: [] };
    case "auton": {
      const assets = await q<{ kind: string; ref_id: string }>("SELECT kind, ref_id FROM auton_assets WHERE user_id=$1 AND kind IN ('bot','managed_bot','agent')", [userId]);
      const botIds = assets.filter((a) => a.kind !== "agent").map((a) => a.ref_id), agentIds = assets.filter((a) => a.kind === "agent").map((a) => a.ref_id);
      return { sql: ` AND ((o.source='bot' AND o.source_ref = ANY($${n}::text[])) OR (o.source='agent' AND o.source_ref = ANY($${n + 1}::text[])))`, params: [botIds, agentIds], bots: botIds.length, agents: agentIds.length };
    }
    default: return { sql: "", params: [] };
  }
}

/** P&L for a scope, optionally only what one Talk tab started. */
export async function scopePnl(userId: string, scope: Scope, rangeSec: number | null, conv?: string | null, ref?: string | null) {
  const c = await scopeCond(userId, scope, 2);
  let sql = c.sql, params: unknown[] = [userId, ...c.params];
  // One bot / AI bot only.
  if (ref) { params.push(ref); sql += ` AND o.source_ref = $${params.length}`; }
  if (conv) {
    const { tabScope, tabOrderCond } = await import("./talk/tab-scope");
    const s = await tabScope(userId, conv);
    sql += tabOrderCond(params.length + 1);
    params = [...params, s.msgIds, s.botIds, s.agentIds];
  }
  // Newest trades for the line (busy accounts have hundreds of thousands; the oldest ones don't matter for a window).
  const orders = (await q<any>(
    `SELECT o.side, o.filled_quantity, o.avg_fill_price, o.realized_pnl, o.updated_at, o.asset_id, a.symbol, a.last_price
       FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.status IN ('filled','partially_filled') ${sql} ORDER BY o.updated_at DESC LIMIT 20000`, params)).reverse();
  // Exact totals straight from the database (every trade, not just the newest 20,000).
  const n = params.length;
  const now = Date.now(), since = rangeSec ? new Date(now - rangeSec * 1000) : new Date(0), prevSince = rangeSec ? new Date(now - 2 * rangeSec * 1000) : new Date(0);
  const t = await one<any>(
    `SELECT COALESCE(SUM(o.realized_pnl) FILTER (WHERE o.side='sell'),0) AS realized,
            COALESCE(SUM(o.realized_pnl) FILTER (WHERE o.side='sell' AND o.updated_at >= $${n + 1}),0) AS win_realized,
            COALESCE(SUM(o.realized_pnl) FILTER (WHERE o.side='sell' AND o.updated_at >= $${n + 2} AND o.updated_at < $${n + 1}),0) AS prev_realized,
            count(*) FILTER (WHERE o.side='sell')::int AS closed, count(*) FILTER (WHERE o.side='sell' AND o.realized_pnl > 0)::int AS wins,
            count(*) FILTER (WHERE o.side='sell' AND o.updated_at >= $${n + 1})::int AS w_closed, count(*) FILTER (WHERE o.side='sell' AND o.updated_at >= $${n + 1} AND o.realized_pnl > 0)::int AS w_wins,
            count(*) FILTER (WHERE o.side='sell' AND o.updated_at >= $${n + 2} AND o.updated_at < $${n + 1})::int AS p_closed,
            count(*) FILTER (WHERE o.side='sell' AND o.updated_at >= $${n + 2} AND o.updated_at < $${n + 1} AND o.realized_pnl > 0)::int AS p_wins,
            count(*)::int AS orders, COALESCE(SUM(o.filled_quantity * o.avg_fill_price) FILTER (WHERE o.side='buy'),0) AS invested
       FROM orders o WHERE o.user_id=$1 AND o.status IN ('filled','partially_filled') ${sql}`, [...params, since, prevSince]);
  const base = pnlFromOrders(orders, rangeSec);
  if (!t) return { scope, ...base, bots: c.bots ?? null, agents: c.agents ?? null };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const winRealized = Number(t.win_realized), realized = Number(t.realized);
  // Line: realized profit built up inside the window (from 0), ending at the window total + open positions.
  const nowSec = Math.floor(now / 1000), sinceSec = Math.floor(since.getTime() / 1000);
  let run = 0;
  const pts: { time: number; value: number; trade?: any }[] = [{ time: rangeSec ? sinceSec : (base.points[0]?.time ?? nowSec - 3600), value: 0 }];
  for (const p of base.points) {
    if (!p.trade) continue;
    if (rangeSec && p.time < sinceSec) continue;
    if (p.trade.side === "sell" && p.trade.pnl != null) run += p.trade.pnl;
    pts.push({ ...p, value: r2(run) });
  }
  // If the newest 20,000 don't reach back to the window start, shift the line so it still ends at the true total.
  const shift = r2(winRealized - run);
  if (Math.abs(shift) > 0.005) for (const p of pts.slice(1)) p.value = r2(p.value + shift);
  const period = r2(winRealized + base.unrealized);
  pts.push({ time: nowSec, value: period });
  return {
    scope, ...base,
    total: r2(realized + base.unrealized), realized: r2(realized), invested: r2(Number(t.invested)), orders: t.orders, closed: t.closed, wins: t.wins,
    period: { pnl: period, realized: r2(winRealized), closed: rangeSec ? t.w_closed : t.closed, wins: rangeSec ? t.w_wins : t.wins },
    previous: rangeSec ? { pnl: r2(Number(t.prev_realized)), closed: t.p_closed, wins: t.p_wins } : null,
    points: pts,
    bots: c.bots ?? null, agents: c.agents ?? null,
  };
}
