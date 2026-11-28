-- Owner request (2026-11-28): turn off every skill and point "for now". Only the platform owner's account; nothing is
-- deleted, so each one can be switched back on from the Skills menu ("turn on all skills").
UPDATE skills SET active = false, updated_at = now()
 WHERE active AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
