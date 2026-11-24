import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import { effectiveTradability } from "@/server/engine/engine";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const asset = await one<any>("SELECT * FROM assets WHERE id=$1", [id]);
  if (!asset) throw new HttpError(404, "Asset not found");
  const [identifiers, providers, positions, orders, trades, watch, tradability] = await Promise.all([
    q("SELECT scheme, value FROM asset_identifiers WHERE asset_id=$1", [id]),
    q("SELECT provider_id, provider_symbol FROM asset_providers WHERE asset_id=$1", [id]),
    q(`SELECT p.*, t.label, t.kind FROM positions p JOIN trading_accounts t ON t.id=p.account_id WHERE p.user_id=$1 AND p.asset_id=$2 AND p.quantity > 0`, [u.id, id]),
    q(`SELECT id, side, order_type, quantity, notional_usd, limit_price, stop_price, status, status_reason, filled_quantity, avg_fill_price, is_paper, source, created_at
         FROM orders WHERE user_id=$1 AND asset_id=$2 ORDER BY created_at DESC LIMIT 50`, [u.id, id]),
    // Recent fills across all users on this asset (anonymised) — paper fills are labeled.
    q(`SELECT o.side, e.quantity, e.price, e.executed_at, o.is_paper FROM executions e JOIN orders o ON o.id=e.order_id WHERE o.asset_id=$1 ORDER BY e.executed_at DESC LIMIT 30`, [id]),
    one(`SELECT wi.target_price FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id WHERE w.user_id=$1 AND wi.asset_id=$2`, [u.id, id]),
    effectiveTradability(asset),
  ]);
  return ok({ asset, identifiers, providers, positions, orders, trades, watched: !!watch, targetPrice: (watch as any)?.target_price ?? null, tradability });
});
