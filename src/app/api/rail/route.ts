import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";

/** Right-bar extras: your single orders (prompt box, manual, shortcuts), and (owner) every automated trader that's set up. */
export const GET = route(async () => {
  const u = await requireUser();
  const promptTrades = await q<any>(
    `SELECT o.id, o.side, o.status, o.source, o.notional_usd, o.quantity, o.filled_quantity, o.avg_fill_price, o.is_paper, o.created_at, o.updated_at, a.symbol, a.id AS asset_id
       FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.source IN ('prompt','manual','shortcut','conditional') ORDER BY o.created_at DESC LIMIT 30`, [u.id]);
  let automation: any = null;
  if (u.role === "super_admin") {
    const s = await one<any>("SELECT enabled, modo_autopilot FROM auto_trading WHERE user_id=$1", [u.id]);
    const strategies = await q<any>("SELECT id, name, kind, enabled, cardinality(asset_ids) AS assets FROM auto_strategies WHERE user_id=$1 ORDER BY created_at", [u.id]);
    const follows = await q<any>(
      `SELECT f.id, f.label, f.mode, f.status, f.sizing, (SELECT count(*)::int FROM copy_trade_events e WHERE e.follow_id=f.id AND e.status='copied') AS copied
         FROM copy_follows f WHERE f.follower_id=$1 ORDER BY f.created_at DESC`, [u.id]);
    const auto = await one<any>(`SELECT count(*) FILTER (WHERE status='open')::int AS open, count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today,
                                        count(*) FILTER (WHERE origin='modo' AND status='open')::int AS modo_open FROM auto_trades WHERE user_id=$1`, [u.id]);
    automation = { autoTrading: !!s?.enabled, modoAutopilot: !!s?.modo_autopilot, strategies, follows, autoOpen: auto?.open ?? 0, autoToday: auto?.today ?? 0, modoOpen: auto?.modo_open ?? 0 };
  }
  return ok({ promptTrades, automation });
});
