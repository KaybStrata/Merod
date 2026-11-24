-- Multi-screen auto trading workspace: several strategies at once, scheduled tasks, hand-picked assets.
CREATE TABLE IF NOT EXISTS auto_strategies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('multi_asset','momentum','rotation','breakout','ai_swing')),
  asset_ids   UUID[] NOT NULL DEFAULT '{}',
  timeframe   TEXT NOT NULL DEFAULT '5m',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auto_strategies_user_idx ON auto_strategies (user_id);

CREATE TABLE IF NOT EXISTS auto_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('run','rebalance','take_profit_sweep','close_risky')),
  at_time        TEXT NOT NULL CHECK (at_time ~ '^[0-2][0-9]:[0-5][0-9]$'),   -- HH:MM in tz
  tz             TEXT NOT NULL DEFAULT 'America/New_York',
  days           TEXT NOT NULL DEFAULT 'weekdays' CHECK (days IN ('daily','weekdays')),
  enabled        BOOLEAN NOT NULL DEFAULT true,
  last_run_date  DATE,
  last_result    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auto_tasks_user_idx ON auto_tasks (user_id);

ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS asset_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE auto_trades ADD COLUMN IF NOT EXISTS strategy_id UUID REFERENCES auto_strategies(id) ON DELETE SET NULL;
