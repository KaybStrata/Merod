-- Auton: Merod's autonomous trader. It studies all of the user's trading history and all coin/stock data, then creates
-- and manages its own bots, agents, skills, e-wallets, map setups and prompts, within a budget (paper by default).
CREATE TABLE IF NOT EXISTS auton_settings (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active           BOOLEAN NOT NULL DEFAULT false,
  every_sec        INTEGER NOT NULL DEFAULT 300 CHECK (every_sec >= 60),
  max_capital_usd  NUMERIC NOT NULL DEFAULT 1000 CHECK (max_capital_usd >= 0),
  max_bots         INTEGER NOT NULL DEFAULT 5 CHECK (max_bots BETWEEN 0 AND 50),
  real_money       BOOLEAN NOT NULL DEFAULT false,
  goals            TEXT NOT NULL DEFAULT '',
  conversation_id  UUID,                  -- the Talk tab it reports to
  memory           JSONB NOT NULL DEFAULT '{}',
  last_run_at      TIMESTAMPTZ,
  next_run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auton_settings_due_idx ON auton_settings (next_run_at) WHERE active;

CREATE TABLE IF NOT EXISTS auton_events (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id  UUID,
  kind             TEXT NOT NULL CHECK (kind IN ('thought', 'analysis', 'decision', 'execution', 'warning')),
  title            TEXT NOT NULL,
  body             TEXT,
  data             JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auton_events_user_idx ON auton_events (user_id, id DESC);
CREATE INDEX IF NOT EXISTS auton_events_conv_idx ON auton_events (conversation_id, id DESC);

-- What Auton made (so it manages its own things and never touches the user's unless they attach them to Auton on the map).
CREATE TABLE IF NOT EXISTS auton_assets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('bot', 'agent', 'skill', 'point', 'e_wallet', 'map', 'prompt', 'managed_bot', 'managed_agent')),
  ref_id      TEXT NOT NULL,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref_id)
);
