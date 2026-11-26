-- Merod Multi: concurrent trading sessions (spec §03).
CREATE TABLE IF NOT EXISTS trading_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  strategy_version_id  UUID NOT NULL REFERENCES strategy_versions(id),
  environment          TEXT NOT NULL DEFAULT 'paper' CHECK (environment IN ('simulation','paper','live')),
  account_id           UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,
  allocation_usd       NUMERIC(20,2) NOT NULL CHECK (allocation_usd > 0),
  mode                 TEXT NOT NULL DEFAULT 'approval' CHECK (mode IN ('manual','approval','semi_auto','auto','observation')),
  state                TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','VALIDATING','READY','RUNNING','PAUSING','PAUSED','AWAITING_APPROVAL','BLOCKED','DEGRADED','STOPPING','STOPPED','ERROR','ARCHIVED')),
  revision             INT NOT NULL DEFAULT 1,
  bot_id               UUID REFERENCES trading_bots(id) ON DELETE SET NULL,
  last_error           TEXT,
  pinned               BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trading_sessions_user_idx ON trading_sessions (user_id, state);

CREATE TABLE IF NOT EXISTS session_events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
  actor_id    UUID,
  action      TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT,
  revision    INT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_events_session_idx ON session_events (session_id, id DESC);
