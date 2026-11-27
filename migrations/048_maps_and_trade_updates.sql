-- Map: a canvas where the user lays out bots, agents, prompts, skills and points, attaches them to each other and
-- groups them into reusable "methods". Nodes reference real records (bot/agent/skill ids) or hold their own text (prompts).
CREATE TABLE IF NOT EXISTS strategy_maps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'My map',
  nodes      JSONB NOT NULL DEFAULT '[]',
  edges      JSONB NOT NULL DEFAULT '[]',
  viewport   JSONB,
  last_run   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategy_maps_user_idx ON strategy_maps (user_id, updated_at DESC);

-- Talk "Update" / "Record": analyses of recent trading with proposed decisions (pause a losing bot, tighten a stop,
-- avoid a coin…). Record mode keeps producing them on a schedule until turned off.
CREATE TABLE IF NOT EXISTS trade_updates (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'record')),
  hours      NUMERIC NOT NULL,
  stats      JSONB NOT NULL,
  decisions  JSONB NOT NULL DEFAULT '[]',
  applied    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_updates_user_idx ON trade_updates (user_id, id DESC);

CREATE TABLE IF NOT EXISTS trade_recording (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active      BOOLEAN NOT NULL DEFAULT true,
  every_min   INTEGER NOT NULL DEFAULT 60 CHECK (every_min >= 5),
  auto_apply  BOOLEAN NOT NULL DEFAULT false,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_recording_due_idx ON trade_recording (next_run_at) WHERE active;
