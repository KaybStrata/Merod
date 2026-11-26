-- Versioned strategies (spec §04/§05): a strategy has immutable versions; editing creates a new version.
CREATE TABLE IF NOT EXISTS strategies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategies_user_idx ON strategies (user_id);

CREATE TABLE IF NOT EXISTS strategy_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version           INT NOT NULL CHECK (version > 0),
  parent_version_id UUID REFERENCES strategy_versions(id),
  schema_version    INT NOT NULL,
  rules             JSONB NOT NULL,
  content_hash      TEXT NOT NULL,
  summary           TEXT NOT NULL,
  source_prompt     TEXT,
  validation        JSONB,            -- last validation result {ok, errors[], warnings[], at}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, version)
);
-- Versions are immutable: rules/hash can never change after insert.
CREATE OR REPLACE FUNCTION strategy_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.rules IS DISTINCT FROM OLD.rules OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'strategy versions are immutable; create a new version instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS strategy_versions_immutable ON strategy_versions;
CREATE TRIGGER strategy_versions_immutable BEFORE UPDATE ON strategy_versions FOR EACH ROW EXECUTE FUNCTION strategy_versions_immutable();
