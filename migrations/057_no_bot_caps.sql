-- Bots no longer have a budget, daily spend cap or daily loss cap (0 = no limit). Clear them on every bot,
-- and wake bots that were halted only because they hit one of those caps.
UPDATE trading_bots SET budget_usd = 0, max_daily_spend_usd = 0, max_daily_loss_usd = 0
 WHERE budget_usd <> 0 OR max_daily_spend_usd <> 0 OR max_daily_loss_usd <> 0;
UPDATE trading_bots b SET status = 'running', updated_at = now()
 WHERE status = 'halted'
   AND (SELECT message FROM bot_activity_logs l WHERE l.bot_id = b.id ORDER BY created_at DESC LIMIT 1) = 'Halted: max loss reached';
-- Owner request (2026-11-28): no daily limits on the owner's account either (0 = no limit). Real money still
-- needs the real-money switch and 2FA; the engine still checks buying power, liquidity and slippage.
UPDATE risk_settings SET max_daily_spend_usd = 0, max_daily_loss_usd = 0 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE trading_permissions SET auto_daily_cap_usd = 0 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
