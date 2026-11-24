-- User-supplied ("bring your own") API keys, encrypted per user. Only used for that user's own requests.
CREATE TABLE IF NOT EXISTS user_provider_secrets (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id  TEXT NOT NULL,
  environment  TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
  name         TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  last4        TEXT,
  status       TEXT NOT NULL DEFAULT 'untested' CHECK (status IN ('untested','connected','error')),
  last_error   TEXT,
  tested_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider_id, environment, name)
);
ALTER TABLE user_provider_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_provider_secrets_owner ON user_provider_secrets USING (user_id::text = current_setting('app.user_id', true));

-- Admin-registered custom REST providers (any API not yet covered by a built-in adapter).
CREATE TABLE IF NOT EXISTS custom_providers (
  id            TEXT PRIMARY KEY,                -- slug, e.g. custom_kraken
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('crypto_execution','stock_execution','market_data','blockchain_infra','wallet','ai')),
  description   TEXT NOT NULL DEFAULT '',
  docs_url      TEXT,
  base_url      TEXT NOT NULL,
  auth_style    TEXT NOT NULL CHECK (auth_style IN ('header','bearer','query','basic','none')),
  auth_header   TEXT,                            -- header or query param name
  test_path     TEXT NOT NULL DEFAULT '/',
  test_expect   TEXT,                            -- optional JSON key that must exist in the response
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
