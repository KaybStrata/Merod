-- Owner request (2026-11-28): delete all skills and points (the features stay for later).
DELETE FROM auton_assets WHERE kind = 'skill' AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
DELETE FROM skills WHERE user_id IN (SELECT id FROM users WHERE role = 'super_admin');
