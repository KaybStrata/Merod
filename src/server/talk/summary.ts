import { one, q } from "../db";

/**
 * Paper portfolio summary used by Talk mode (digest + portfolio widget). Same math as /api/dashboard.
 * riskUsedPct = today's spend vs the daily spend limit, or null when that limit is 0 (= no limit).
 */
export async function paperSummary(userId: string) {
  const account = await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId]);
  const holdings = await q<any>(
    `SELECT p.quantity, a.last_price, a.change_24h FROM positions p JOIN assets a ON a.id=p.asset_id JOIN trading_accounts t ON t.id=p.account_id
      WHERE p.user_id=$1 AND t.kind='paper' AND p.quantity > 0`, [userId]);
  const cash = Number(account?.cash_balance ?? 0);
  let invested = 0, dayPnl = 0;
  for (const h of holdings) {
    const v = Number(h.quantity) * Number(h.last_price ?? 0);
    invested += v;
    const ch = Number(h.change_24h ?? 0) / 100;
    dayPnl += v - v / (1 + ch);
  }
  const risk = await one<any>("SELECT max_daily_spend_usd FROM risk_settings WHERE user_id=$1", [userId]);
  const limit = Number(risk?.max_daily_spend_usd ?? 0);
  let riskUsedPct: number | null = null;
  if (limit > 0) {
    const spent = await one<any>(
      `SELECT COALESCE(SUM(COALESCE(notional_usd, filled_quantity*avg_fill_price)),0) AS s FROM orders
        WHERE user_id=$1 AND side='buy' AND status IN ('filled','partially_filled','submitted') AND created_at >= date_trunc('day', now())`, [userId]);
    riskUsedPct = Math.min(100, Math.round((Number(spent?.s ?? 0) / limit) * 1000) / 10);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { total: round(cash + invested), dayPnl: round(dayPnl), cash: round(cash), riskUsedPct };
}

export async function agentItems(userId: string, limit = 6) {
  return q<any>(
    `SELECT id::text, name, status, (SELECT title FROM agent_events e WHERE e.agent_id=a.id ORDER BY created_at DESC LIMIT 1) AS note
       FROM agents a WHERE user_id=$1 AND status <> 'archived' ORDER BY (status='running') DESC, updated_at DESC LIMIT $2`, [userId, limit]);
}
