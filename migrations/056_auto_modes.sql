-- Auto switches: Auto trainer, Auto gainer, Auto adjuster, Auto scanner.
-- One row per (mode, scope): scope 'all' = every bot/agent; scope 'bot'/'agent' = just that one (from a map or a bot's page).
-- Auto trainer's global switch is mirrored into auto_training_settings.enabled (the existing trainer does the work).
CREATE TABLE IF NOT EXISTS auto_modes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('trainer', 'gainer', 'adjuster', 'scanner')),
  scope        TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'bot', 'agent')),
  scope_ref    TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT false,
  settings     JSONB NOT NULL DEFAULT '{}',
  state        JSONB NOT NULL DEFAULT '{}',
  last_run_at  TIMESTAMPTZ,
  last_note    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, mode, scope, scope_ref)
);
CREATE INDEX IF NOT EXISTS auto_modes_active_idx ON auto_modes (mode) WHERE active;
