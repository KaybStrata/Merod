-- Merod core schema. PostgreSQL 14+ (Supabase compatible).
-- Money/quantities use NUMERIC to avoid floating-point drift.
-- Raw provider credentials are NEVER stored here in plaintext: provider_secrets holds
-- AES-256-GCM ciphertext only, encrypted with MEROD_MASTER_KEY (or an external KMS).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────── Identity ─────────────────────────
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','compliance','support')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  totp_secret_enc  TEXT,                -- encrypted TOTP seed
  totp_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  country          TEXT,
  trading_mode     TEXT NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper','live')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_idx ON users(lower(email));

CREATE TABLE user_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle           TEXT UNIQUE NOT NULL,
  display_name     TEXT NOT NULL,
  bio              TEXT DEFAULT '',
  avatar_color     TEXT DEFAULT '#7c5cff',
  is_public        BOOLEAN NOT NULL DEFAULT TRUE,
  share_performance BOOLEAN NOT NULL DEFAULT FALSE, -- explicit consent to show verified performance
  theme            TEXT NOT NULL DEFAULT 'dark',
  dashboard_layout JSONB NOT NULL DEFAULT '[]',
  ai_provider      TEXT NOT NULL DEFAULT 'anthropic',
  ai_model         TEXT NOT NULL DEFAULT 'claude-opus-5-5',
  notification_prefs JSONB NOT NULL DEFAULT '{"fills":true,"bots":true,"alerts":true,"social":true,"email":false}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL UNIQUE,   -- SHA-256 of the cookie token
  mfa_passed       BOOLEAN NOT NULL DEFAULT FALSE,
  ip               TEXT,
  user_agent       TEXT,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ───────────────────────── Providers ─────────────────────────
CREATE TABLE provider_configs (
  provider_id      TEXT NOT NULL,
  environment      TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
  status           TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN (
                     'not_configured','credentials_configured','testing','sandbox_connected',
                     'awaiting_approval','production_connected','restricted','connection_error','disabled')),
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status  TEXT NOT NULL DEFAULT 'not_requested' CHECK (approval_status IN ('not_requested','requested','approved','denied')),
  settings         JSONB NOT NULL DEFAULT '{}',  -- non-secret settings (base URLs, RPC URLs, webhook URL)
  last_success_at  TIMESTAMPTZ,
  last_tested_at   TIMESTAMPTZ,
  last_error       TEXT,
  credentials_rotated_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, environment)
);

CREATE TABLE provider_secrets (
  provider_id      TEXT NOT NULL,
  environment      TEXT NOT NULL,
  name             TEXT NOT NULL,            -- e.g. JUPITER_API_KEY
  ciphertext       TEXT NOT NULL,            -- base64(iv|tag|data), AES-256-GCM
  key_version      INT NOT NULL DEFAULT 1,
  last4            TEXT,                     -- masked hint for UI
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, environment, name)
);

CREATE TABLE provider_capabilities (
  provider_id      TEXT NOT NULL,
  capability       TEXT NOT NULL,            -- quote, execute, market_data, discovery, ...
  asset_class      TEXT NOT NULL,            -- crypto, stock, etf, option
  network          TEXT NOT NULL DEFAULT '*',
  PRIMARY KEY (provider_id, capability, asset_class, network)
);

CREATE TABLE provider_events (
  id               BIGSERIAL PRIMARY KEY,
  provider_id      TEXT NOT NULL,
  environment      TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('request','error','test','rate_limit','webhook')),
  status_code      INT,
  latency_ms       INT,
  message          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX provider_events_idx ON provider_events(provider_id, created_at DESC);

-- ───────────────────────── Feature flags & compliance ─────────────────────────
CREATE TABLE feature_flags (
  key              TEXT PRIMARY KEY,
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  description      TEXT NOT NULL,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  approval_reference TEXT,                   -- agreement / license reference recorded by compliance
  updated_by       UUID REFERENCES users(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jurisdiction_rules (
  country          TEXT NOT NULL,
  feature          TEXT NOT NULL,
  allowed          BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (country, feature)
);

CREATE TABLE compliance_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL,            -- kyc, agreement, approval, restriction
  reference        TEXT,
  details          JSONB NOT NULL DEFAULT '{}',
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Assets ─────────────────────────
CREATE TABLE assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class      TEXT NOT NULL CHECK (asset_class IN ('stock','etf','crypto','option')),
  symbol           TEXT NOT NULL,
  name             TEXT NOT NULL,
  venue            TEXT NOT NULL,            -- exchange MIC (XNAS) or chain (solana, ethereum, base...)
  identifier       TEXT NOT NULL,            -- CUSIP/FIGI/ticker@exchange or contract/mint address
  decimals         INT,
  logo_url         TEXT,
  tradability      TEXT NOT NULL DEFAULT 'discoverable' CHECK (tradability IN (
                     'discoverable','view_only','paper_tradable','live_tradable','restricted','unsupported')),
  lifecycle        TEXT,                     -- for pump.fun: bonding_curve | graduated
  categories       TEXT[] NOT NULL DEFAULT '{}',
  risk_flags       TEXT[] NOT NULL DEFAULT '{}',
  coingecko_id     TEXT,
  last_price       NUMERIC,
  change_24h       NUMERIC,
  volume_24h       NUMERIC,
  market_cap       NUMERIC,
  liquidity_usd    NUMERIC,
  price_source     TEXT,                     -- provider id or 'simulated'
  price_updated_at TIMESTAMPTZ,
  launched_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue, identifier)
);
CREATE INDEX assets_symbol_idx ON assets(lower(symbol));
CREATE INDEX assets_name_idx ON assets(lower(name));
CREATE INDEX assets_class_idx ON assets(asset_class);

CREATE TABLE asset_identifiers (
  asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  scheme           TEXT NOT NULL,            -- ticker, cusip, figi, isin, mint, erc20, coingecko, alpaca_id
  value            TEXT NOT NULL,
  PRIMARY KEY (scheme, value)
);

CREATE TABLE asset_providers (
  asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  provider_id      TEXT NOT NULL,
  provider_symbol  TEXT,
  PRIMARY KEY (asset_id, provider_id)
);

CREATE TABLE price_bars (
  asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  timeframe        TEXT NOT NULL,            -- 1m 5m 15m 1h 4h 1d
  ts               TIMESTAMPTZ NOT NULL,
  open NUMERIC NOT NULL, high NUMERIC NOT NULL, low NUMERIC NOT NULL, close NUMERIC NOT NULL,
  volume           NUMERIC NOT NULL DEFAULT 0,
  source           TEXT NOT NULL,
  PRIMARY KEY (asset_id, timeframe, ts)
);

-- ───────────────────────── Accounts & wallets ─────────────────────────
CREATE TABLE trading_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('paper','brokerage','wallet')),
  provider_id      TEXT NOT NULL,            -- paper | alpaca_trading | snaptrade | privy | ...
  label            TEXT NOT NULL,
  external_ref     TEXT,                     -- broker account id / wallet address (never secrets)
  network          TEXT,                     -- for wallets
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','disconnected','restricted')),
  cash_balance     NUMERIC NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'USD',
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trading_accounts_user_idx ON trading_accounts(user_id);

CREATE VIEW connected_brokerages AS SELECT * FROM trading_accounts WHERE kind = 'brokerage';
CREATE VIEW connected_wallets    AS SELECT * FROM trading_accounts WHERE kind = 'wallet';

CREATE TABLE watchlists (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE watchlist_items (
  watchlist_id     UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  target_price     NUMERIC,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, asset_id)
);

-- ───────────────────────── Risk & permissions ─────────────────────────
CREATE TABLE risk_settings (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_order_usd        NUMERIC NOT NULL DEFAULT 1000,
  max_daily_spend_usd  NUMERIC NOT NULL DEFAULT 5000,
  max_daily_loss_usd   NUMERIC NOT NULL DEFAULT 1000,
  max_slippage_bps     INT NOT NULL DEFAULT 100,
  min_liquidity_usd    NUMERIC NOT NULL DEFAULT 50000,
  max_price_age_sec    INT NOT NULL DEFAULT 60,
  block_risky_tokens   BOOLEAN NOT NULL DEFAULT TRUE,
  trading_halted       BOOLEAN NOT NULL DEFAULT FALSE,   -- user-level emergency stop
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trading_permissions (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode                 TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','auto_within_limits','auto_until_approval')),
  auto_max_order_usd   NUMERIC NOT NULL DEFAULT 100,
  auto_daily_cap_usd   NUMERIC NOT NULL DEFAULT 500,
  allow_ai_prompts     BOOLEAN NOT NULL DEFAULT TRUE,
  allow_bots           BOOLEAN NOT NULL DEFAULT TRUE,
  allow_shortcuts      BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_asset_classes TEXT[] NOT NULL DEFAULT '{stock,etf,crypto}',
  -- Only a human session can modify this row; AI/bot code paths have no write access (enforced in app layer).
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Orders & executions ─────────────────────────
CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES trading_accounts(id),
  asset_id         UUID NOT NULL REFERENCES assets(id),
  provider_id      TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('manual','prompt','shortcut','bot','conditional','system')),
  source_ref       TEXT,                     -- bot id / shortcut id / prompt id
  side             TEXT NOT NULL CHECK (side IN ('buy','sell')),
  order_type       TEXT NOT NULL CHECK (order_type IN ('market','limit','stop','stop_limit','trailing_stop')),
  quantity         NUMERIC,                  -- units of asset
  notional_usd     NUMERIC,                  -- or spend amount
  limit_price      NUMERIC,
  stop_price       NUMERIC,
  take_profit      NUMERIC,
  stop_loss        NUMERIC,
  trail_percent    NUMERIC,
  time_in_force    TEXT NOT NULL DEFAULT 'gtc',
  currency         TEXT NOT NULL DEFAULT 'USD',
  spending_limit_usd NUMERIC,
  max_slippage_bps INT,
  expires_at       TIMESTAMPTZ,
  is_paper         BOOLEAN NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('draft','pending_approval','validated','submitted','partially_filled',
                     'filled','cancelled','rejected','expired','failed','unknown')),
  status_reason    TEXT,
  quote            JSONB,                    -- price, fees, slippage estimate, quote id, quoted_at
  auth_info        JSONB,                    -- who/what approved, mode, timestamp
  provider_order_id TEXT,
  filled_quantity  NUMERIC NOT NULL DEFAULT 0,
  avg_fill_price   NUMERIC,
  fees_usd         NUMERIC NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX orders_user_idx ON orders(user_id, created_at DESC);
CREATE INDEX orders_open_idx ON orders(status) WHERE status IN ('submitted','partially_filled','validated','pending_approval','unknown');

CREATE TABLE executions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider_fill_id TEXT,
  quantity         NUMERIC NOT NULL,
  price            NUMERIC NOT NULL,
  fee_usd          NUMERIC NOT NULL DEFAULT 0,
  tx_hash          TEXT,
  executed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, provider_fill_id)
);

CREATE TABLE transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES trading_accounts(id),
  kind             TEXT NOT NULL CHECK (kind IN ('deposit','withdrawal','trade','fee','reset','transfer')),
  asset_id         UUID REFERENCES assets(id),
  amount           NUMERIC NOT NULL,
  amount_usd       NUMERIC,
  status           TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','failed','awaiting_authorization')),
  tx_hash          TEXT,
  reference        TEXT,
  receipt          JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transactions_user_idx ON transactions(user_id, created_at DESC);

CREATE TABLE positions (
  account_id       UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  asset_id         UUID NOT NULL REFERENCES assets(id),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity         NUMERIC NOT NULL DEFAULT 0,
  avg_cost         NUMERIC NOT NULL DEFAULT 0,
  realized_pnl     NUMERIC NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, asset_id)
);

CREATE TABLE portfolio_snapshots (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_paper         BOOLEAN NOT NULL,
  ts               TIMESTAMPTZ NOT NULL,
  total_value      NUMERIC NOT NULL,
  cash             NUMERIC NOT NULL,
  breakdown        JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, is_paper, ts)
);

-- ───────────────────────── AI prompts ─────────────────────────
CREATE TABLE ai_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'New conversation',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE trading_prompts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id  UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content          TEXT NOT NULL,
  ai_provider      TEXT,
  ai_model         TEXT,
  interpretation   JSONB,                    -- validated structured intent
  plan             JSONB,                    -- execution plan with quotes
  status           TEXT NOT NULL DEFAULT 'info',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE saved_prompts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Shortcuts ─────────────────────────
CREATE TABLE shortcut_folders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL
);
CREATE TABLE trading_shortcuts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id        UUID REFERENCES shortcut_folders(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  icon             TEXT NOT NULL DEFAULT 'zap',
  color            TEXT,
  asset_id         UUID REFERENCES assets(id),          -- null = applies to currently viewed asset
  asset_category   TEXT,
  account_id       UUID REFERENCES trading_accounts(id),
  actions          JSONB NOT NULL,                      -- array of ShortcutAction (multi-action)
  max_spend_usd    NUMERIC,
  max_slippage_bps INT,
  require_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  conditions       JSONB NOT NULL DEFAULT '[]',
  expires_at       TIMESTAMPTZ,
  placement        TEXT[] NOT NULL DEFAULT '{terminal}',  -- terminal, dashboard
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE shortcut_executions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut_id      UUID NOT NULL REFERENCES trading_shortcuts(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id         UUID REFERENCES assets(id),
  status           TEXT NOT NULL,
  order_ids        UUID[] NOT NULL DEFAULT '{}',
  detail           JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Bots ─────────────────────────
CREATE TABLE bot_strategies (
  id               TEXT PRIMARY KEY,                    -- recurring_buy, price_trigger, ...
  name             TEXT NOT NULL,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL,
  param_schema     JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE trading_bots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  strategy_id      TEXT NOT NULL REFERENCES bot_strategies(id),
  params           JSONB NOT NULL DEFAULT '{}',
  asset_ids        UUID[] NOT NULL DEFAULT '{}',
  markets          TEXT[] NOT NULL DEFAULT '{}',
  account_id       UUID NOT NULL REFERENCES trading_accounts(id),
  is_paper         BOOLEAN NOT NULL DEFAULT TRUE,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','stopped','error','halted')),
  budget_usd       NUMERIC NOT NULL DEFAULT 1000,
  max_position_usd NUMERIC NOT NULL DEFAULT 250,
  max_daily_spend_usd NUMERIC NOT NULL DEFAULT 500,
  max_daily_loss_usd  NUMERIC NOT NULL DEFAULT 100,
  max_trades_per_day  INT NOT NULL DEFAULT 10,
  min_liquidity_usd   NUMERIC NOT NULL DEFAULT 50000,
  max_slippage_bps    INT NOT NULL DEFAULT 100,
  max_price_deviation_pct NUMERIC NOT NULL DEFAULT 5,
  profit_target_pct   NUMERIC,
  stop_loss_pct       NUMERIC,
  schedule         TEXT NOT NULL DEFAULT 'every_1m',    -- every_1m | every_5m | every_1h | cron expr
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  notify           JSONB NOT NULL DEFAULT '{"trades":true,"errors":true}',
  spent_today_usd  NUMERIC NOT NULL DEFAULT 0,
  trades_today     INT NOT NULL DEFAULT 0,
  pnl_usd          NUMERIC NOT NULL DEFAULT 0,
  day_anchor       DATE NOT NULL DEFAULT CURRENT_DATE,
  state            JSONB NOT NULL DEFAULT '{}',          -- strategy memory (last buy time, etc.)
  last_tick_at     TIMESTAMPTZ,
  lease_owner      TEXT,                                -- worker id holding the lease
  lease_expires_at TIMESTAMPTZ,
  created_from_prompt TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trading_bots_status_idx ON trading_bots(status);

CREATE TABLE bot_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id           UUID NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('live','paper','backtest')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  result           JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE bot_activity_logs (
  id               BIGSERIAL PRIMARY KEY,
  bot_id           UUID NOT NULL REFERENCES trading_bots(id) ON DELETE CASCADE,
  level            TEXT NOT NULL CHECK (level IN ('observation','trigger','instruction','order','result','warning','error','control')),
  message          TEXT NOT NULL,
  data             JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_logs_idx ON bot_activity_logs(bot_id, created_at DESC);

CREATE TABLE price_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id         UUID NOT NULL REFERENCES assets(id),
  direction        TEXT NOT NULL CHECK (direction IN ('above','below')),
  price            NUMERIC NOT NULL,
  triggered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,           -- fill, bot, alert, social, system
  title            TEXT NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  link             TEXT,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

-- ───────────────────────── Social ─────────────────────────
CREATE TABLE followers (
  follower_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE TABLE social_posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('post','trade','analysis','strategy')),
  body             TEXT NOT NULL,
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers','private')),
  tags             TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX social_posts_idx ON social_posts(created_at DESC);
CREATE TABLE tagged_trades (
  post_id          UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  asset_id         UUID NOT NULL REFERENCES assets(id),
  -- verification is derived server-side from a real filled order owned by the poster:
  verification     TEXT NOT NULL CHECK (verification IN ('verified_live','simulated','unverified')),
  side             TEXT,
  entry_price      NUMERIC,
  PRIMARY KEY (post_id, asset_id)
);
CREATE TABLE post_likes (post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (post_id, user_id));
CREATE TABLE post_bookmarks (post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (post_id, user_id));
CREATE TABLE post_comments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── System & audit ─────────────────────────
CREATE TABLE system_events (
  id               BIGSERIAL PRIMARY KEY,
  source           TEXT NOT NULL,           -- worker, engine, provider, admin
  level            TEXT NOT NULL CHECK (level IN ('info','warn','error','critical')),
  message          TEXT NOT NULL,
  data             JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE worker_heartbeats (
  worker_id        TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  info             JSONB NOT NULL DEFAULT '{}'
);

-- Append-only audit log with a hash chain for tamper evidence.
CREATE TABLE audit_logs (
  id               BIGSERIAL PRIMARY KEY,
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('user','admin','ai','bot','shortcut','system','worker')),
  actor_id         TEXT,
  user_id          UUID,
  action           TEXT NOT NULL,
  target           TEXT,
  data             JSONB NOT NULL DEFAULT '{}',
  ip               TEXT,
  prev_hash        TEXT,
  hash             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_user_idx ON audit_logs(user_id, created_at DESC);
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE rate_limits (
  key              TEXT PRIMARY KEY,
  window_start     TIMESTAMPTZ NOT NULL,
  count            INT NOT NULL
);
