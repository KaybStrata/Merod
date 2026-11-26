import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/**
 * Your filled trades, newest first: ?type=buy (purchase history), sell (sold), profit (sells that made money).
 * Includes every source (manual, prompts, bots, agents, auto trading, Modo, mimic) and both paper and real money.
 */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") === "sell" ? "sell" : sp.get("type") === "profit" ? "profit" : "buy";
  const limit = Math.min(2000, Math.max(1, Number(sp.get("limit") ?? 500)));
  const rows = await q<any>(
    `SELECT o.id, o.side, o.source, o.is_paper, o.filled_quantity AS qty, o.avg_fill_price AS price, o.filled_quantity*o.avg_fill_price AS value,
            o.realized_pnl, o.fees_usd, o.updated_at AS at, a.id AS asset_id, a.symbol, a.name, a.asset_class, t.label AS account
       FROM orders o JOIN assets a ON a.id=o.asset_id JOIN trading_accounts t ON t.id=o.account_id
      WHERE o.user_id=$1 AND o.status IN ('filled','partially_filled') AND o.filled_quantity > 0
        AND ($2 = 'buy' AND o.side='buy' OR $2 = 'sell' AND o.side='sell' OR $2 = 'profit' AND o.side='sell' AND COALESCE(o.realized_pnl,0) > 0)
      ORDER BY o.updated_at DESC LIMIT $3`, [u.id, type, limit]);
  const totals = rows.reduce((t, r) => ({ value: t.value + Number(r.value ?? 0), pnl: t.pnl + Number(r.realized_pnl ?? 0) }), { value: 0, pnl: 0 });
  return ok({ type, rows, count: rows.length, totals });
});
