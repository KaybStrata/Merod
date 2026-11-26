-- Merod Agents: prompted multi-agent trading system (Prompted Multi-Agent spec §01–§19). Paper-first.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('manual','prompt','shortcut','bot','conditional','system','copy','auto','agent'));

CREATE TABLE IF NOT EXISTS agent_fleets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  prompt           TEXT,
  operation_mode   TEXT NOT NULL DEFAULT 'parallel' CHECK (operation_mode IN ('independent','parallel','collaborative','competition','supervisor','sequential')),
  supervisor_id    UUID,
  graph            JSONB NOT NULL DEFAULT '{"edges":[]}',
  shared_policy    JSONB NOT NULL DEFAULT '{"conflict":"reject","shareKnowledge":true}',
  capital_usd      NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (capital_usd >= 0),
  reserve_usd      NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (reserve_usd >= 0),
  daily_loss_pct   NUMERIC(6,3) NOT NULL DEFAULT 2 CHECK (daily_loss_pct > 0 AND daily_loss_pct <= 100),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','running','paused','risk_blocked','archived')),
  risk_blocked_at  TIMESTAMPTZ,
  stop_reason      TEXT,
  is_collection    BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_fleets_user_idx ON agent_fleets (user_id, status);

CREATE TABLE IF NOT EXISTS agents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fleet_id         UUID REFERENCES agent_fleets(id) ON DELETE SET NULL,
  parent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
  lineage          TEXT NOT NULL DEFAULT 'created' CHECK (lineage IN ('created','forked','merged','spawned','installed','templated')),
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  instructions     TEXT NOT NULL DEFAULT '',
  asset_ids        UUID[] NOT NULL DEFAULT '{}',
  universe         JSONB NOT NULL DEFAULT '{}',
  strategy         JSONB NOT NULL DEFAULT '{}',
  model            TEXT NOT NULL DEFAULT 'auto',
  tool_policy      JSONB NOT NULL DEFAULT '{}',
  autonomy_level   INT NOT NULL DEFAULT 1 CHECK (autonomy_level BETWEEN 1 AND 6),
  mode             TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  account_id       UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,
  capital_usd      NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (capital_usd >= 0),
  risk             JSONB NOT NULL DEFAULT '{}',
  schedule         JSONB NOT NULL DEFAULT '{"kind":"continuous","everySec":60}',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','configured','pending_approval','queued','running','paused','risk_blocked','failed','completed','archived')),
  stop_reason      TEXT,
  version          INT NOT NULL DEFAULT 1,
  revision         INT NOT NULL DEFAULT 1,
  locked_strategy  BOOLEAN NOT NULL DEFAULT false,
  memory           JSONB NOT NULL DEFAULT '{"notes":[],"lessons":[],"preferences":[]}',
  state            JSONB NOT NULL DEFAULT '{}',
  metrics          JSONB NOT NULL DEFAULT '{}',
  realized_pnl_usd NUMERIC(20,2) NOT NULL DEFAULT 0,
  fail_count       INT NOT NULL DEFAULT 0,
  last_tick_at     TIMESTAMPTZ,
  last_event_at    TIMESTAMPTZ,
  lease_owner      TEXT,
  lease_expires_at TIMESTAMPTZ,
  pinned           BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agents_user_idx ON agents (user_id, status);
CREATE INDEX IF NOT EXISTS agents_fleet_idx ON agents (fleet_id);
CREATE INDEX IF NOT EXISTS agents_due_idx ON agents (status, last_tick_at);

-- Immutable configuration history (Version History, Live Prompt Editing, rollback).
CREATE TABLE IF NOT EXISTS agent_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version          INT NOT NULL,
  config           JSONB NOT NULL,
  change_note      TEXT,
  created_by       TEXT NOT NULL DEFAULT 'user',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
CREATE OR REPLACE FUNCTION agent_versions_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'agent versions are immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS agent_versions_no_update ON agent_versions;
CREATE TRIGGER agent_versions_no_update BEFORE UPDATE ON agent_versions FOR EACH ROW EXECUTE FUNCTION agent_versions_immutable();

-- Black box: every thought / analysis / decision / execution / warning / state change, with inputs.
CREATE TABLE IF NOT EXISTS agent_events (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id         UUID REFERENCES agents(id) ON DELETE CASCADE,
  fleet_id         UUID REFERENCES agent_fleets(id) ON DELETE CASCADE,
  version          INT,
  kind             TEXT NOT NULL CHECK (kind IN ('thought','analysis','decision','execution','warning','approval','state','message','training','system')),
  title            TEXT NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  data             JSONB NOT NULL DEFAULT '{}',
  correlation_id   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_events_user_idx ON agent_events (user_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_events_agent_idx ON agent_events (agent_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_events_fleet_idx ON agent_events (fleet_id, id DESC);

-- Agent rooms (Merod Nexus): structured messages between agents and the user.
CREATE TABLE IF NOT EXISTS agent_messages (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room             TEXT NOT NULL,
  fleet_id         UUID REFERENCES agent_fleets(id) ON DELETE CASCADE,
  sender_agent_id  UUID REFERENCES agents(id) ON DELETE SET NULL,
  sender_label     TEXT NOT NULL,
  recipients       TEXT[] NOT NULL DEFAULT '{}',
  msg_type         TEXT NOT NULL DEFAULT 'finding' CHECK (msg_type IN ('finding','proposal','validation','counterargument','handoff','escalation','instruction','knowledge','vote')),
  body             TEXT NOT NULL,
  refs             JSONB NOT NULL DEFAULT '[]',
  correlation_id   TEXT,
  depth            INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_messages_room_idx ON agent_messages (user_id, room, id DESC);

-- Merod Vault: shared knowledge library contributed by authorised agents.
CREATE TABLE IF NOT EXISTS agent_knowledge (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fleet_id         UUID REFERENCES agent_fleets(id) ON DELETE CASCADE,
  agent_id         UUID REFERENCES agents(id) ON DELETE SET NULL,
  topic            TEXT NOT NULL,
  body             TEXT NOT NULL,
  source           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_knowledge_user_idx ON agent_knowledge (user_id, id DESC);

-- Equity snapshots per agent (cards, drawdown, arena scoring).
CREATE TABLE IF NOT EXISTS agent_snapshots (
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  ts               TIMESTAMPTZ NOT NULL DEFAULT now(),
  equity_usd       NUMERIC(20,2) NOT NULL,
  invested_usd     NUMERIC(20,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, ts)
);

-- Agent Arena: normalised paper competitions.
CREATE TABLE IF NOT EXISTS agent_competitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  objective        TEXT NOT NULL,
  rules            JSONB NOT NULL DEFAULT '{}',
  capital_each_usd NUMERIC(20,2) NOT NULL DEFAULT 10000,
  days             INT NOT NULL DEFAULT 30 CHECK (days BETWEEN 1 AND 365),
  scoring          TEXT NOT NULL DEFAULT 'risk_adjusted',
  status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','cancelled')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at          TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_competition_entries (
  competition_id   UUID NOT NULL REFERENCES agent_competitions(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  strategy_label   TEXT NOT NULL,
  disqualified     TEXT,
  PRIMARY KEY (competition_id, agent_id)
);

-- Auto-training candidates (Merod Forge): proposal → evidence → approve/reject → new version.
CREATE TABLE IF NOT EXISTS agent_training_candidates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_version     INT NOT NULL,
  diagnosis        JSONB NOT NULL DEFAULT '{}',
  proposed         JSONB NOT NULL,
  evidence         JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','superseded')),
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_training_agent_idx ON agent_training_candidates (agent_id, created_at DESC);

-- Merod Exchange: agent / fleet template listings. Payments are disabled until compliance review (spec §12, §15).
CREATE TABLE IF NOT EXISTS agent_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL DEFAULT 'agent' CHECK (kind IN ('agent','fleet')),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  category         TEXT NOT NULL DEFAULT 'strategy',
  risk_profile     TEXT NOT NULL DEFAULT 'medium' CHECK (risk_profile IN ('low','medium','high')),
  config           JSONB NOT NULL,
  permissions      JSONB NOT NULL DEFAULT '{}',
  version          INT NOT NULL DEFAULT 1,
  change_note      TEXT,
  visibility       TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  moderation       TEXT NOT NULL DEFAULT 'approved' CHECK (moderation IN ('pending','approved','revoked')),
  performance      JSONB NOT NULL DEFAULT '{}',
  installs         INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_listings_vis_idx ON agent_listings (visibility, moderation);

-- Saved workspace layouts.
CREATE TABLE IF NOT EXISTS agent_layouts (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  layout           JSONB NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);
