-- Skills: standing instructions that shape how Merod, Modo, OpenAI/Claude, bots and agents think, decide and execute.
-- `instructions` is the user's own text (given to every AI answer and plan); `rules` holds what Merod can enforce itself
-- (stop-loss / take-profit / per-trade amount / dip for bots and agents, sell-only-in-profit, never-buy / only-trade lists, max per trade).
CREATE TABLE IF NOT EXISTS skills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  instructions TEXT NOT NULL,
  rules        JSONB NOT NULL DEFAULT '{}',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skills_user_idx ON skills (user_id, active);

-- Schedules: a prompt that runs on its own at set times ("every morning at 2am Los Angeles time, buy …").
CREATE TABLE IF NOT EXISTS prompt_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt       TEXT NOT NULL,
  label        TEXT NOT NULL,
  spec         JSONB NOT NULL,           -- { kind: daily|weekly|interval, hour, minute, weekdays[], everyMin, tz }
  next_run_at  TIMESTAMPTZ NOT NULL,
  last_run_at  TIMESTAMPTZ,
  last_result  TEXT,
  runs         INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prompt_schedules_due_idx ON prompt_schedules (next_run_at) WHERE active;
