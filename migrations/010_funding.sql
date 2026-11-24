-- Deposits, withdrawals and third-party crypto transfers.
-- Non-custodial: crypto transfers are signed by the user's own wallet. Bank details are never stored
-- (only a provider relationship id + last 4 digits).

CREATE TABLE IF NOT EXISTS withdrawal_addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  network       TEXT NOT NULL,
  address       TEXT NOT NULL,
  usable_after  TIMESTAMPTZ NOT NULL,              -- cooling period for newly added addresses
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, network, address)
);

CREATE TABLE IF NOT EXISTS bank_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,                     -- alpaca_broker
  external_ref  TEXT NOT NULL,                     -- provider ACH relationship id
  nickname      TEXT,
  mask          TEXT,                              -- last 4 digits only
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','removed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funding_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES trading_accounts(id),
  direction        TEXT NOT NULL CHECK (direction IN ('deposit','withdrawal')),
  rail             TEXT NOT NULL CHECK (rail IN ('paper','ach','crypto')),
  asset_id         UUID REFERENCES assets(id),
  network          TEXT,
  amount           NUMERIC NOT NULL CHECK (amount > 0),
  amount_usd       NUMERIC,
  address_id       UUID REFERENCES withdrawal_addresses(id),
  bank_link_id     UUID REFERENCES bank_links(id),
  status           TEXT NOT NULL CHECK (status IN ('pending_signature','pending','submitted','completed','failed','cancelled','blocked')),
  status_reason    TEXT,
  provider_ref     TEXT,
  unsigned_tx      JSONB,
  tx_hash          TEXT,
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS funding_requests_user_idx ON funding_requests(user_id, created_at DESC);

ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS max_daily_withdrawal_usd NUMERIC NOT NULL DEFAULT 10000;

ALTER TABLE withdrawal_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY withdrawal_addresses_owner ON withdrawal_addresses USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE bank_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_links_owner ON bank_links USING (user_id::text = current_setting('app.user_id', true));
ALTER TABLE funding_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY funding_requests_owner ON funding_requests USING (user_id::text = current_setting('app.user_id', true));
