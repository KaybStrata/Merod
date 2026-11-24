import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/** Unified portfolio. Paper (simulated) and live funds are reported separately even when shown together. */
export const GET = route(async () => {
  const u = await requireUser();
  const [accounts, positions, transactions, openOrders, bots, byAsset, byProvider, bySource] = await Promise.all([
    q<any>(`SELECT id, kind, provider_id, label, external_ref, network, status, cash_balance, currency, metadata->>'environment' AS environment,
                   COALESCE((metadata->>'starting_balance')::numeric, 0) AS starting_balance, (metadata->>'byo_keys')::boolean AS byo_keys, created_at
              FROM trading_accounts WHERE user_id=$1 ORDER BY created_at`, [u.id]),
    q<any>(`SELECT p.account_id, p.asset_id, p.quantity, p.avg_cost, p.realized_pnl, t.label AS account_label, t.kind AS account_kind,
                   (t.kind='paper' OR t.metadata->>'environment'='sandbox') AS is_paper,
                   a.symbol, a.name, a.asset_class, a.venue, a.last_price, a.change_24h, a.price_source, a.logo_url,
                   p.quantity*a.last_price AS market_value, p.quantity*(a.last_price-p.avg_cost) AS unrealized_pnl,
                   (SELECT array_agg(close ORDER BY ts) FROM (SELECT close, ts FROM price_bars b WHERE b.asset_id=a.id AND b.timeframe='1h' ORDER BY ts DESC LIMIT 24) s) AS spark
              FROM positions p JOIN assets a ON a.id=p.asset_id JOIN trading_accounts t ON t.id=p.account_id
             WHERE p.user_id=$1 AND (p.quantity > 0 OR p.realized_pnl <> 0) ORDER BY market_value DESC NULLS LAST`, [u.id]),
    q(`SELECT tr.*, a.symbol, t.label AS account_label FROM transactions tr LEFT JOIN assets a ON a.id=tr.asset_id JOIN trading_accounts t ON t.id=tr.account_id
        WHERE tr.user_id=$1 ORDER BY tr.created_at DESC LIMIT 100`, [u.id]),
    q(`SELECT o.*, a.symbol, a.name, a.venue FROM orders o JOIN assets a ON a.id=o.asset_id
        WHERE o.user_id=$1 AND o.status IN ('pending_approval','validated','submitted','partially_filled','unknown') ORDER BY o.created_at DESC`, [u.id]),
    q(`SELECT b.id, b.name, b.strategy_id, b.status, b.is_paper, b.pnl_usd, b.trades_today, b.budget_usd, s.name AS strategy_name
         FROM trading_bots b JOIN bot_strategies s ON s.id=b.strategy_id WHERE b.user_id=$1 AND b.status IN ('running','paused','halted','error') ORDER BY b.created_at DESC`, [u.id]),
    q(`SELECT a.symbol, o.is_paper, count(*)::int AS trades, COALESCE(sum(o.realized_pnl),0) AS realized_pnl, COALESCE(sum(o.filled_quantity*o.avg_fill_price),0) AS volume
         FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.user_id=$1 AND o.status='filled' GROUP BY a.symbol, o.is_paper ORDER BY realized_pnl DESC`, [u.id]),
    q(`SELECT provider_id, is_paper, count(*)::int AS trades, COALESCE(sum(realized_pnl),0) AS realized_pnl, COALESCE(sum(filled_quantity*avg_fill_price),0) AS volume
         FROM orders WHERE user_id=$1 AND status='filled' GROUP BY provider_id, is_paper ORDER BY volume DESC`, [u.id]),
    q(`SELECT source, is_paper, count(*)::int AS trades, COALESCE(sum(realized_pnl),0) AS realized_pnl, COALESCE(sum(filled_quantity*avg_fill_price),0) AS volume
         FROM orders WHERE user_id=$1 AND status='filled' GROUP BY source, is_paper ORDER BY volume DESC`, [u.id]),
  ]);

  const summarize = (paper: boolean) => {
    const accts = accounts.filter((a) => (a.kind === "paper" || a.environment === "sandbox") === paper);
    const pos = positions.filter((p) => p.is_paper === paper && Number(p.quantity) > 0);
    const cash = accts.reduce((s, a) => s + Number(a.cash_balance), 0);
    const invested = pos.reduce((s, p) => s + Number(p.market_value ?? 0), 0);
    const unrealized = pos.reduce((s, p) => s + Number(p.unrealized_pnl ?? 0), 0);
    const realized = positions.filter((p) => p.is_paper === paper).reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0);
    const starting = accts.reduce((s, a) => s + Number(a.starting_balance ?? 0), 0);
    const daily = pos.reduce((s, p) => {
      const ch = Number(p.change_24h ?? 0) / 100;
      return s + Number(p.market_value ?? 0) * (ch / (1 + ch));
    }, 0);
    const stocks = pos.filter((p) => ["stock", "etf", "option"].includes(p.asset_class)).reduce((s, p) => s + Number(p.market_value ?? 0), 0);
    return {
      total: cash + invested, cash, invested, unrealized, realized, dailyPnl: daily,
      lifetimePnl: starting ? cash + invested - starting : realized + unrealized, starting,
      allocation: { stocks, crypto: invested - stocks, cash },
    };
  };
  return ok({ accounts, positions, transactions, openOrders, bots, performance: { byAsset, byProvider, bySource }, paper: summarize(true), live: summarize(false) });
});
