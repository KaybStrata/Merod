-- Advisor: always-on analysis of coin/stock data and of the user's own trades, bots, agents and prompts,
-- producing suggestions ("tips"). Turned on/off from the left sidebar; stays on until the user turns it off.
CREATE TABLE IF NOT EXISTS advisor_settings (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active      BOOLEAN NOT NULL DEFAULT true,
  every_min   INTEGER NOT NULL DEFAULT 10 CHECK (every_min >= 2),
  topics      JSONB NOT NULL DEFAULT '{"market":true,"trades":true,"bots":true,"agents":true,"prompts":true}',
  notify      BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advisor_settings_due_idx ON advisor_settings (next_run_at) WHERE active;

CREATE TABLE IF NOT EXISTS advisor_tips (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic        TEXT NOT NULL CHECK (topic IN ('market', 'trades', 'bots', 'agents', 'prompts')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  link         TEXT,
  action       JSONB,
  priority     SMALLINT NOT NULL DEFAULT 2,
  dedupe_key   TEXT NOT NULL,
  applied_at   TIMESTAMPTZ,
  applied_note TEXT,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advisor_tips_user_idx ON advisor_tips (user_id, id DESC);
CREATE INDEX IF NOT EXISTS advisor_tips_dedupe_idx ON advisor_tips (user_id, dedupe_key, created_at DESC);
