-- Points: specific instructions ("focus on SOL ecosystem coins today", "don't open new trades until the Fed meeting",
-- "take profits early this week") that sit next to Skills. A Skill shapes overall decision making permanently;
-- a Point is a pointed instruction, optionally for a limited time (expires_at).
ALTER TABLE skills ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'skill';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE skills ADD CONSTRAINT skills_kind_check CHECK (kind IN ('skill', 'point'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
