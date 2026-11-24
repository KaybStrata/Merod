-- Merod AI learnings: insights derived from trade outcomes, each with evidence and an optional
-- proposed update the user can apply ("Update") — applied changes are revertible via training_adjustments.
CREATE TABLE IF NOT EXISTS ai_learnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,   -- NULL = platform-wide (anonymized aggregate)
  scope           TEXT NOT NULL CHECK (scope IN ('personal','platform')),
  key             TEXT NOT NULL,                                 -- dedupe key, e.g. source:prompt
  category        TEXT NOT NULL,                                 -- performance, asset, execution, strategy, timing, platform
  title           TEXT NOT NULL,
  insight         TEXT NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '{}',
  confidence      TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  sample_size     INT NOT NULL DEFAULT 0,
  proposed_update JSONB,                                         -- null = insight only
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','applied','dismissed','superseded')),
  adjustment_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_learnings_active_key ON ai_learnings (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key) WHERE status IN ('new');
CREATE INDEX IF NOT EXISTS ai_learnings_user_idx ON ai_learnings (user_id, updated_at DESC);
ALTER TABLE training_adjustments DROP CONSTRAINT IF EXISTS training_adjustments_target_type_check;
ALTER TABLE training_adjustments ADD CONSTRAINT training_adjustments_target_type_check CHECK (target_type IN ('bot','shortcut','prompt_defaults','risk_settings'));
