-- Limits of 0 now mean "no limit" (the engine still always checks the account's real buying power).
-- The platform owner asked for no caps: clear the owner's order/day/loss/automation limits and bot caps.
UPDATE risk_settings SET max_order_usd = 0, max_daily_spend_usd = 0, max_daily_loss_usd = 0
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE trading_permissions SET auto_max_order_usd = 0, auto_daily_cap_usd = 0
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE trading_bots SET budget_usd = 0, max_position_usd = 0, max_daily_spend_usd = 0, max_daily_loss_usd = 0
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE copy_follows SET max_trade_usd = 1000000, max_daily_usd = 10000000
 WHERE follower_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE trading_accounts SET metadata = jsonb_set(metadata, '{limits}', '{"perTradeUsd": 0, "dailyUsd": 0}'::jsonb)
 WHERE provider_id = 'merod_wallet' AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
