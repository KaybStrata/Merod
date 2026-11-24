import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";

/**
 * Progress for the signed-in user only: their bots, prompts, shortcut buttons and trades.
 * "Today" is the last 24 hours. The UI refreshes this on realtime events and on a timer.
 */
export const GET = route(async () => {
  const u = await requireUser();
  const [trades, open, prompts, shortcuts, bots, recentOrders, recentPrompts, recentShortcuts] = await Promise.all([
    one<any>(`SELECT count(*) FILTER (WHERE status='filled')::int AS filled,
                     count(*) FILTER (WHERE status IN ('rejected','failed'))::int AS failed,
                     count(*) FILTER (WHERE status='filled' AND side='buy')::int AS buys,
                     count(*) FILTER (WHERE status='filled' AND side='sell')::int AS sells,
                     COALESCE(SUM(filled_quantity*avg_fill_price) FILTER (WHERE status IN ('filled','partially_filled')),0) AS volume,
                     COALESCE(SUM(realized_pnl) FILTER (WHERE status='filled'),0) AS pnl,
                     count(*) FILTER (WHERE side='sell' AND status='filled' AND realized_pnl > 0)::int AS wins,
                     count(*) FILTER (WHERE side='sell' AND status='filled' AND realized_pnl < 0)::int AS losses
                FROM orders WHERE user_id=$1 AND updated_at > now() - interval '24 hours'`, [u.id]),
    q(`SELECT o.id, o.side, o.order_type, o.status, o.quantity, o.notional_usd, o.filled_quantity, o.limit_price, o.is_paper AS paper, o.source, o.created_at,
              a.symbol, a.id AS asset_id
         FROM orders o JOIN assets a ON a.id=o.asset_id
        WHERE o.user_id=$1 AND o.status IN ('pending_approval','validated','submitted','partially_filled','unknown')
        ORDER BY o.created_at DESC LIMIT 15`, [u.id]),
    one<any>(`SELECT count(*)::int AS total,
                     count(*) FILTER (WHERE status IN ('executed','info','approved'))::int AS done,
                     count(*) FILTER (WHERE status IN ('needs_approval','clarify'))::int AS waiting,
                     count(*) FILTER (WHERE status IN ('rejected','error','failed','dismissed'))::int AS failed
                FROM trading_prompts WHERE user_id=$1 AND role='assistant' AND created_at > now() - interval '24 hours'`, [u.id]),
    one<any>(`SELECT count(*) FILTER (WHERE status <> 'previewed')::int AS total,
                     count(*) FILTER (WHERE status='executed')::int AS done,
                     count(*) FILTER (WHERE status IN ('partial','executing'))::int AS partial,
                     count(*) FILTER (WHERE status='failed')::int AS failed
                FROM shortcut_executions WHERE user_id=$1 AND created_at > now() - interval '24 hours'`, [u.id]),
    q(`SELECT b.id, b.name, b.status, b.is_paper AS paper, b.pnl_usd, b.trades_today, b.max_trades_per_day, b.spent_today_usd, b.max_daily_spend_usd,
              b.budget_usd, b.profit_target_pct, b.last_tick_at,
              (SELECT array_agg(symbol) FROM assets WHERE id = ANY(b.asset_ids)) AS symbols,
              (SELECT message FROM bot_activity_logs WHERE bot_id=b.id ORDER BY created_at DESC LIMIT 1) AS last_message
         FROM trading_bots b WHERE b.user_id=$1 AND b.status <> 'stopped'
        ORDER BY (b.status='running') DESC, b.updated_at DESC LIMIT 12`, [u.id]),
    q(`SELECT o.id, o.side, o.status, o.status_reason, o.filled_quantity, o.avg_fill_price, o.notional_usd, o.realized_pnl, o.is_paper AS paper, o.source, o.updated_at,
              a.symbol, a.id AS asset_id
         FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 ORDER BY o.updated_at DESC LIMIT 8`, [u.id]),
    q(`SELECT id, created_at, content, status, conversation_id FROM trading_prompts WHERE user_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 6`, [u.id]),
    q(`SELECT x.id, x.created_at, x.status, s.name, s.color, s.icon FROM shortcut_executions x JOIN trading_shortcuts s ON s.id=x.shortcut_id
        WHERE x.user_id=$1 AND x.status <> 'previewed' ORDER BY x.created_at DESC LIMIT 6`, [u.id]),
  ]);
  return ok({
    today: { trades, prompts, shortcuts },
    bots, openOrders: open, recent: { orders: recentOrders, prompts: recentPrompts, shortcuts: recentShortcuts },
    at: new Date().toISOString(),
  });
});
