-- Copy trading: follow a trader (with their consent) or a public on-chain wallet, and mirror their trades.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS allow_copy_trading BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('manual','prompt','shortcut','bot','conditional','system','copy'));

CREATE TABLE IF NOT EXISTS copy_follows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('user','wallet')),
  leader_user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_network   TEXT,
  wallet_address   TEXT,
  label            TEXT NOT NULL,
  account_id       UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,   -- where copies go (NULL = paper)
  sizing           TEXT NOT NULL DEFAULT 'fixed' CHECK (sizing IN ('fixed','percent')),
  fixed_usd        NUMERIC NOT NULL DEFAULT 50,
  percent          NUMERIC NOT NULL DEFAULT 10,         -- % of the leader's trade size
  max_trade_usd    NUMERIC NOT NULL DEFAULT 250,
  max_daily_usd    NUMERIC NOT NULL DEFAULT 1000,
  copy_sells       BOOLEAN NOT NULL DEFAULT true,
  include_external BOOLEAN NOT NULL DEFAULT true,       -- leader's own brokerage/exchange trades made outside Merod
  include_paper    BOOLEAN NOT NULL DEFAULT true,       -- leader's paper (practice) trades on Merod
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  cursor           JSONB NOT NULL DEFAULT '{}',
  last_checked_at  TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'user' AND leader_user_id IS NOT NULL) OR (kind = 'wallet' AND wallet_address IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS copy_follows_user_uq ON copy_follows (follower_id, leader_user_id) WHERE kind = 'user';
CREATE UNIQUE INDEX IF NOT EXISTS copy_follows_wallet_uq ON copy_follows (follower_id, wallet_network, wallet_address) WHERE kind = 'wallet';

CREATE TABLE IF NOT EXISTS copy_trade_events (
  id                BIGSERIAL PRIMARY KEY,
  follow_id         UUID NOT NULL REFERENCES copy_follows(id) ON DELETE CASCADE,
  leader_ref        TEXT NOT NULL,          -- execution id / external fill id / tx signature (dedupe)
  origin            TEXT NOT NULL CHECK (origin IN ('merod','broker','onchain')),
  venue             TEXT,                    -- e.g. Merod, Alpaca, Kraken, Solana wallet
  symbol            TEXT,
  asset_id          UUID REFERENCES assets(id) ON DELETE SET NULL,
  side              TEXT NOT NULL CHECK (side IN ('buy','sell')),
  leader_qty        NUMERIC,
  leader_price      NUMERIC,
  leader_at         TIMESTAMPTZ,
  status            TEXT NOT NULL CHECK (status IN ('copied','pending_approval','skipped','failed')),
  reason            TEXT,
  follower_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  copy_notional     NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follow_id, leader_ref)
);
CREATE INDEX IF NOT EXISTS copy_trade_events_follow_idx ON copy_trade_events (follow_id, created_at DESC);
