-- Auto-training: bounded, rule-based self-correction of bots, shortcuts and prompt-trade defaults.
-- It may only REDUCE risk relative to the user's original configuration and never touches permissions.
CREATE TABLE IF NOT EXISTS auto_training_settings (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  scope_bots           BOOLEAN NOT NULL DEFAULT TRUE,
  scope_shortcuts      BOOLEAN NOT NULL DEFAULT TRUE,
  scope_prompts        BOOLEAN NOT NULL DEFAULT TRUE,
  pause_after_losses   INT NOT NULL DEFAULT 3 CHECK (pause_after_losses BETWEEN 1 AND 20),
  max_adjustments_per_day INT NOT NULL DEFAULT 10 CHECK (max_adjustments_per_day BETWEEN 1 AND 100),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE trading_bots ADD COLUMN IF NOT EXISTS auto_training TEXT NOT NULL DEFAULT 'inherit' CHECK (auto_training IN ('inherit','on','off'));
ALTER TABLE trading_bots ADD COLUMN IF NOT EXISTS original_config JSONB;
ALTER TABLE trading_bots ADD COLUMN IF NOT EXISTS training_cursor TIMESTAMPTZ;
ALTER TABLE trading_bots ADD COLUMN IF NOT EXISTS loss_streak INT NOT NULL DEFAULT 0;

ALTER TABLE trading_shortcuts ADD COLUMN IF NOT EXISTS auto_training TEXT NOT NULL DEFAULT 'inherit' CHECK (auto_training IN ('inherit','on','off'));
ALTER TABLE trading_shortcuts ADD COLUMN IF NOT EXISTS original_config JSONB;
ALTER TABLE trading_shortcuts ADD COLUMN IF NOT EXISTS training_cursor TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS prompt_trading_defaults (
  user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_stop_loss_pct NUMERIC,
  max_prompt_order_usd  NUMERIC,
  learned_from          JSONB NOT NULL DEFAULT '{}',
  training_cursor       TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_adjustments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('bot','shortcut','prompt_defaults')),
  target_id   TEXT NOT NULL,
  target_name TEXT,
  rule        TEXT NOT NULL,
  reason      TEXT NOT NULL,
  evidence    JSONB NOT NULL DEFAULT '{}',
  before      JSONB NOT NULL,
  after       JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','reverted')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS training_adjustments_user_idx ON training_adjustments(user_id, created_at DESC);
ALTER TABLE training_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_adjustments_owner ON training_adjustments USING (user_id::text = current_setting('app.user_id', true));
