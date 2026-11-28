-- Rules: instructions aimed at one bot, all bots, prompted trades, or everything (Modo / Merod trading in general).
-- They live next to Skills and Points and are enforced the same way, but only on what they target.
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_kind_check;
ALTER TABLE skills ADD CONSTRAINT skills_kind_check CHECK (kind IN ('skill', 'point', 'rule'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_scope_check;
ALTER TABLE skills ADD CONSTRAINT skills_scope_check CHECK (scope IN ('all', 'bots', 'bot', 'prompts'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS scope_ref TEXT;
-- Owner asked for all skills to be deleted; "Auton rules" came back while the old worker was still running. Remove it.
DELETE FROM auton_assets WHERE kind = 'skill' AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
DELETE FROM skills WHERE name = 'Auton rules' AND user_id IN (SELECT id FROM users WHERE role = 'super_admin');
