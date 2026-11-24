import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/**
 * Live activity backfill (the page then streams new events over WebSocket, with polling fallback).
 * scope=mine     → this user's bot decisions, orders/fills, shortcut runs, AI prompts, auto-training changes
 * scope=platform → anonymized trade tape of all fills on Merod (a handle is shown only for users who opted in
 *                  to public performance sharing). Paper fills are labeled.
 */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") === "platform" ? "platform" : "mine";
  const limit = Math.min(Number(sp.get("limit") ?? 150), 400);

  if (scope === "platform") {
    const trades = await q(
      `SELECT e.id, e.executed_at AS ts, o.side, e.quantity, e.price, o.is_paper AS paper, o.source, a.symbol, a.id AS asset_id, a.venue,
              CASE WHEN p.is_public AND p.share_performance THEN p.handle ELSE NULL END AS handle, CASE WHEN p.is_public AND p.share_performance THEN p.display_name END AS display_name, (p.is_public AND p.share_performance AND p.allow_copy_trading) AS copyable
         FROM executions e JOIN orders o ON o.id=e.order_id JOIN assets a ON a.id=o.asset_id JOIN user_profiles p ON p.user_id=o.user_id
        ORDER BY e.executed_at DESC LIMIT $1`, [limit]);
    const stats = await q(
      `SELECT count(*)::int AS fills, count(DISTINCT o.user_id)::int AS traders, COALESCE(SUM(e.quantity*e.price),0) AS volume,
              count(*) FILTER (WHERE o.source='bot')::int AS bot_fills
         FROM executions e JOIN orders o ON o.id=e.order_id WHERE e.executed_at > now() - interval '24 hours'`);
    const runningBots = await q(`SELECT count(*)::int AS n FROM trading_bots WHERE status='running'`);
    return ok({ scope, trades, stats: { ...stats[0], runningBots: runningBots[0]?.n ?? 0 } });
  }

  const [botLogs, orders, shortcuts, prompts, training, bots] = await Promise.all([
    q(`SELECT l.id, l.created_at AS ts, l.level, l.message, b.id AS bot_id, b.name AS bot_name FROM bot_activity_logs l JOIN trading_bots b ON b.id=l.bot_id
        WHERE b.user_id=$1 ORDER BY l.created_at DESC LIMIT $2`, [u.id, limit]),
    q(`SELECT o.id, o.updated_at AS ts, o.status, o.status_reason, o.side, o.order_type, o.quantity, o.notional_usd, o.filled_quantity, o.avg_fill_price,
              o.is_paper AS paper, o.source, o.source_ref, a.symbol, a.id AS asset_id
         FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 ORDER BY o.updated_at DESC LIMIT $2`, [u.id, limit]),
    q(`SELECT x.id, x.created_at AS ts, x.status, s.name, s.id AS shortcut_id FROM shortcut_executions x JOIN trading_shortcuts s ON s.id=x.shortcut_id
        WHERE x.user_id=$1 ORDER BY x.created_at DESC LIMIT 50`, [u.id]),
    q(`SELECT id, created_at AS ts, content, status, conversation_id FROM trading_prompts WHERE user_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 50`, [u.id]),
    q(`SELECT id, created_at AS ts, target_type, target_id, target_name, reason, status FROM training_adjustments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [u.id]),
    q(`SELECT b.id, b.name, b.status, b.strategy_id, b.is_paper, b.pnl_usd, b.trades_today, b.last_tick_at, b.asset_ids,
              (SELECT array_agg(symbol) FROM assets WHERE id = ANY(b.asset_ids)) AS symbols,
              (SELECT message FROM bot_activity_logs WHERE bot_id=b.id ORDER BY created_at DESC LIMIT 1) AS last_message
         FROM trading_bots b WHERE b.user_id=$1 AND b.status IN ('running','paused','halted','error') ORDER BY b.status='running' DESC, b.last_tick_at DESC NULLS LAST`, [u.id]),
  ]);
  const events = [
    ...botLogs.map((r: any) => ({ kind: "bot", ...r })),
    ...orders.map((r: any) => ({ kind: "order", ...r })),
    ...shortcuts.map((r: any) => ({ kind: "shortcut", ...r })),
    ...prompts.map((r: any) => ({ kind: "prompt", ...r })),
    ...training.map((r: any) => ({ kind: "training", ...r })),
  ].sort((a: any, b: any) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, limit);
  return ok({ scope, events, bots });
});
