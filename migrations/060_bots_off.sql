-- Owner request (2026-11-28): "turn off bots". Migration 059 restarted bots that had been stopped; undo that:
-- every bot and AI bot paused, Auton off. Nothing trades until the owner turns them back on.
UPDATE trading_bots SET status = 'paused', updated_at = now()
 WHERE status IN ('running', 'halted', 'error') AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE agents SET status = 'paused', stop_reason = 'Turned off by the owner'
 WHERE status IN ('running', 'queued') AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
UPDATE auton_settings SET active = false WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
