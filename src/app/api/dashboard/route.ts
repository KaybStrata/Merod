import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";

/** Home dashboard summary for the signed-in user's paper (simulated) portfolio. */
export const GET = route(async () => {
  const u = await requireUser();
  const account = await one<any>("SELECT * FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [u.id]);
  const holdings = await q<any>(
    `SELECT p.asset_id, p.quantity, p.avg_cost, p.realized_pnl, a.symbol, a.name, a.asset_class, a.venue, a.last_price, a.change_24h, a.price_source, a.logo_url,
            (SELECT array_agg(close ORDER BY ts) FROM (SELECT close, ts FROM price_bars b WHERE b.asset_id=a.id AND b.timeframe='1h' ORDER BY ts DESC LIMIT 24) s) AS spark
       FROM positions p JOIN assets a ON a.id=p.asset_id JOIN trading_accounts t ON t.id=p.account_id
      WHERE p.user_id=$1 AND t.kind='paper' AND p.quantity > 0 ORDER BY p.quantity*a.last_price DESC`, [u.id]);
  const cash = Number(account?.cash_balance ?? 0);
  let invested = 0, unrealized = 0, dayChange = 0;
  for (const h of holdings) {
    const v = Number(h.quantity) * Number(h.last_price ?? 0);
    h.value = v;
    h.unrealized = (Number(h.last_price ?? 0) - Number(h.avg_cost)) * Number(h.quantity);
    invested += v; unrealized += h.unrealized;
    const ch = Number(h.change_24h ?? 0) / 100;
    dayChange += v - v / (1 + ch);
  }
  const total = cash + invested;
  const starting = Number(account?.metadata?.starting_balance ?? 100000);
  const realized = Number((await one<any>("SELECT COALESCE(SUM(realized_pnl),0) AS r FROM positions WHERE user_id=$1", [u.id]))?.r ?? 0);
  const allocation = { stocks: 0, crypto: 0, cash };
  for (const h of holdings) { if (h.asset_class === "crypto") allocation.crypto += h.value; else allocation.stocks += h.value; }
  const [recentOrders, bots, posts, watchlist, pending] = await Promise.all([
    q(`SELECT o.id, o.side, o.order_type, o.quantity, o.notional_usd, o.status, o.filled_quantity, o.avg_fill_price, o.is_paper, o.source, o.created_at, a.symbol, a.id AS asset_id
         FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 8`, [u.id]),
    q(`SELECT id, name, strategy_id, status, is_paper, pnl_usd, trades_today, last_tick_at FROM trading_bots WHERE user_id=$1 AND status IN ('running','paused','error','halted') ORDER BY updated_at DESC LIMIT 6`, [u.id]),
    q(`SELECT sp.id, sp.kind, sp.body, sp.tags, sp.created_at, pr.handle, pr.display_name, pr.avatar_color,
              (SELECT verification FROM tagged_trades tt WHERE tt.post_id=sp.id LIMIT 1) AS verification
         FROM social_posts sp JOIN user_profiles pr ON pr.user_id=sp.user_id WHERE sp.visibility='public' ORDER BY sp.created_at DESC LIMIT 4`),
    q(`SELECT DISTINCT ON (a.id) a.id, a.symbol, a.name, a.last_price, a.change_24h, a.price_source, a.logo_url, wi.target_price, wi.added_at,
              (SELECT array_agg(close ORDER BY ts) FROM (SELECT close, ts FROM price_bars b WHERE b.asset_id=a.id AND b.timeframe='1h' ORDER BY ts DESC LIMIT 24) s) AS spark
         FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id JOIN assets a ON a.id=wi.asset_id WHERE w.user_id=$1 ORDER BY a.id, wi.added_at DESC LIMIT 12`, [u.id]).then((r: any[]) => r.sort((x, y) => +new Date(y.added_at) - +new Date(x.added_at))),
    one<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1 AND status='pending_approval'", [u.id]),
  ]);
  return ok({
    account: account ? { id: account.id, label: account.label, kind: account.kind } : null,
    total, cash, invested, unrealized, realized, dayChange, dayChangePct: total - dayChange ? (dayChange / (total - dayChange)) * 100 : 0,
    lifetimePnl: total - starting, lifetimePct: ((total - starting) / starting) * 100, starting,
    holdings, allocation, recentOrders, bots, posts, watchlist, pendingApprovals: pending?.n ?? 0,
  });
});
