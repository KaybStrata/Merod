-- The platform owner asked for zero risk rejections: flagged coins (new listing, unverified, low liquidity) allowed,
-- no minimum liquidity, slippage findings shown but not blocking, and every existing bot set to never reject.
-- Buying power, the emergency stop and needing a live price still apply (a trade can't execute without them).
UPDATE risk_settings SET block_risky_tokens = false, min_liquidity_usd = 0, max_slippage_bps = 5000
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE trading_bots SET allow_risky = true, min_liquidity_usd = 0
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
