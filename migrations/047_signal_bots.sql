-- Signal bots: outside programs (Freqtrade, Hummingbot scripts, OctoBot, Jesse, TradingView alerts, any script) send
-- buy/sell signals to a personal webhook URL; Merod places the orders through its own engine and risk checks.
-- Paper by default; a key only trades real money when its owner turns that on for that key.
CREATE TABLE IF NOT EXISTS signal_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  key_prefix    TEXT NOT NULL,
  account_id    UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  per_trade_usd NUMERIC NOT NULL DEFAULT 100,
  max_order_usd NUMERIC NOT NULL DEFAULT 0,
  max_daily_usd NUMERIC NOT NULL DEFAULT 0,
  allow_live    BOOLEAN NOT NULL DEFAULT false,
  last_used_at  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signal_keys_user_idx ON signal_keys (user_id);

CREATE TABLE IF NOT EXISTS signal_events (
  id         BIGSERIAL PRIMARY KEY,
  key_id     UUID NOT NULL REFERENCES signal_keys(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT,
  symbol     TEXT,
  status     TEXT NOT NULL,
  reason     TEXT,
  order_id   UUID,
  notional   NUMERIC,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signal_events_key_idx ON signal_events (key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS signal_events_user_idx ON signal_events (user_id, created_at DESC);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('manual','prompt','shortcut','bot','conditional','system','copy','auto','agent','signal'));
