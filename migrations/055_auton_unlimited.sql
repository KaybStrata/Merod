-- Auton can check as often as every 5 seconds; 0 budget / 0 bots = no limit.
ALTER TABLE auton_settings DROP CONSTRAINT IF EXISTS auton_settings_every_sec_check;
ALTER TABLE auton_settings ADD CONSTRAINT auton_settings_every_sec_check CHECK (every_sec >= 5);
-- Owner request (2026-11-28): no budget limit, no bot limit, check every 5 seconds.
UPDATE auton_settings SET active = true, max_capital_usd = 0, max_bots = 0, every_sec = 5, next_run_at = now(),
       goals = CASE WHEN goals ILIKE '%autons trading by%' THEN '' ELSE goals END
 WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
-- If the owner never started Auton, start it now with the same settings (paper money).
INSERT INTO auton_settings (user_id, active, max_capital_usd, max_bots, every_sec, next_run_at)
SELECT id, true, 0, 0, 5, now() FROM users WHERE role = 'super_admin'
ON CONFLICT (user_id) DO NOTHING;
