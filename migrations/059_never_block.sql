-- "Never block": limits, screening, approvals and permission checks can't stop a user's bots, AI bots, Auton or
-- prompts from buying and selling (paper: orders larger than the cash are resized to what's available; sells of more
-- than is held sell what's held). Real-money legal checks, the user's own emergency stop and their own skills stay.
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS never_block BOOLEAN NOT NULL DEFAULT false;
-- Owner request (2026-11-28): nothing can stop the owner's bots and prompts from trading.
UPDATE risk_settings SET never_block = true, trading_halted = false, max_order_usd = 0, max_daily_spend_usd = 0, max_daily_loss_usd = 0, block_risky_tokens = false, min_liquidity_usd = 0
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE trading_permissions SET mode = 'auto_within_limits', allow_bots = true, allow_ai_prompts = true, allow_shortcuts = true, auto_max_order_usd = 0, auto_daily_cap_usd = 0,
       allowed_asset_classes = ARRAY['stock','etf','crypto','option']
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
-- Bots that were halted by a limit start again.
UPDATE trading_bots SET status = 'running', updated_at = now()
 WHERE status IN ('halted', 'error') AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
-- AI bots and fleets stopped by a loss limit start again.
UPDATE agent_fleets SET status = 'running', risk_blocked_at = NULL, stop_reason = NULL
 WHERE status = 'risk_blocked' AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE agents SET status = 'queued', stop_reason = NULL
 WHERE status = 'risk_blocked' AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
