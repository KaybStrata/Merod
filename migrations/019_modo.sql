-- Modo: trading-idea assistant. Ideas are scored, then checked against what the price actually did,
-- and Modo re-weights its signals from those results.
CREATE TABLE IF NOT EXISTS modo_ideas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id      UUID REFERENCES assets(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('buy','sell')),
  thesis        TEXT NOT NULL,
  risk          TEXT,
  signals       JSONB NOT NULL DEFAULT '{}',   -- {news, crowd, momentum, own} contributions
  confidence    NUMERIC NOT NULL,              -- 0..1
  price_at      NUMERIC,
  price_source  TEXT,
  ret_1h        NUMERIC,                       -- signed return in the idea's direction
  ret_24h       NUMERIC,
  evaluated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS modo_ideas_user_idx ON modo_ideas (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS modo_ideas_eval_idx ON modo_ideas (created_at) WHERE ret_24h IS NULL;

CREATE TABLE IF NOT EXISTS modo_state (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weights     JSONB NOT NULL DEFAULT '{"news":1,"crowd":1,"momentum":1,"own":1}',
  stats       JSONB NOT NULL DEFAULT '{}',
  notes       JSONB NOT NULL DEFAULT '[]',     -- what Modo learned, newest first
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
