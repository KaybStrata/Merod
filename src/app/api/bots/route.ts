import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { BotConfigSchema, createBot } from "@/server/bots/service";
import { getStrategy } from "@/server/bots/strategies";

export const GET = route(async () => {
  const u = await requireUser();
  const bots = await q<any>(
    `SELECT b.*, s.name AS strategy_name, t.label AS account_label,
            (SELECT array_agg(a.symbol) FROM assets a WHERE a.id = ANY(b.asset_ids)) AS symbols,
            (SELECT row_to_json(l) FROM (SELECT level, message, created_at FROM bot_activity_logs WHERE bot_id=b.id ORDER BY id DESC LIMIT 1) l) AS last_log,
            (SELECT count(*)::int FROM orders o WHERE o.source='bot' AND o.source_ref=b.id::text AND o.status='filled') AS filled_orders,
            (SELECT count(*)::int FROM orders o WHERE o.source='bot' AND o.source_ref=b.id::text AND o.status='filled' AND o.side='sell' AND o.realized_pnl > 0) AS wins,
            (SELECT count(*)::int FROM orders o WHERE o.source='bot' AND o.source_ref=b.id::text AND o.status='filled' AND o.side='sell' AND o.realized_pnl < 0) AS losses,
            (SELECT COALESCE(SUM(o.filled_quantity*o.avg_fill_price),0) FROM orders o WHERE o.source='bot' AND o.source_ref=b.id::text AND o.status IN ('filled','partially_filled') AND o.updated_at > now() - interval '24 hours') AS volume_24h,
            (SELECT row_to_json(f) FROM (SELECT o.side, o.filled_quantity, o.avg_fill_price, o.updated_at, a.symbol FROM orders o JOIN assets a ON a.id=o.asset_id
               WHERE o.source='bot' AND o.source_ref=b.id::text AND o.status='filled' ORDER BY o.updated_at DESC LIMIT 1) f) AS last_fill
       FROM trading_bots b JOIN bot_strategies s ON s.id=b.strategy_id JOIN trading_accounts t ON t.id=b.account_id
      WHERE b.user_id=$1 ORDER BY (b.status='running') DESC, b.updated_at DESC`, [u.id]);
  return ok({ bots });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const cfg = await parse(req, BotConfigSchema);
  if (!getStrategy(cfg.strategyId)) throw new HttpError(400, "Unknown strategy");
  try { return ok({ bot: await createBot(u.id, cfg, "user") }); }
  catch (e: any) { if (e instanceof HttpError) throw e; throw new HttpError(400, e.message); }
});
