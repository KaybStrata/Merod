-- The platform owner asked for orders to approve themselves: automation runs automatically within limits (all 0 = no limit),
-- bots don't ask before each trade, and Supervised (level 4) agents move to Conditional (level 5: execute automatically).
UPDATE trading_permissions SET mode = 'auto_within_limits', allow_ai_prompts = true, allow_bots = true, allow_shortcuts = true
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE trading_bots SET approval_required = false
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE agents SET autonomy_level = 5
 WHERE autonomy_level = 4 AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
-- Bot buys/sells stuck waiting for approval are cancelled; each bot sees the cancel and places a fresh order at today's price.
UPDATE orders SET status = 'cancelled', status_reason = 'Auto-approve turned on: the bot re-places this order at the current price', updated_at = now()
 WHERE status = 'pending_approval' AND source IN ('bot', 'agent') AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
