-- E-wallets: named money pots inside Merod (not crypto wallets). Rules channel a share of realized profits into them
-- automatically ("20% of all profits → Savings"); money can also be moved by hand between pots and trading cash.
CREATE TABLE IF NOT EXISTS e_wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  goal_usd    NUMERIC CHECK (goal_usd IS NULL OR goal_usd > 0),
  balance     NUMERIC NOT NULL DEFAULT 0 CHECK (balance >= 0),      -- paper money moved in (spendable back into trading)
  earmarked   NUMERIC NOT NULL DEFAULT 0 CHECK (earmarked >= 0),    -- real-money profits set aside (stays at the broker)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS e_wallets_name_idx ON e_wallets (user_id, lower(name));

CREATE TABLE IF NOT EXISTS e_wallet_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id   UUID NOT NULL REFERENCES e_wallets(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'bot', 'agent', 'source')),
  scope_ref   TEXT,                       -- bot id, agent id, or an order source (manual, prompt, copy, auto, signal…)
  scope_label TEXT,
  percent     NUMERIC NOT NULL CHECK (percent > 0 AND percent <= 100),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS e_wallet_rules_user_idx ON e_wallet_rules (user_id) WHERE active;

CREATE TABLE IF NOT EXISTS e_wallet_entries (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id   UUID NOT NULL REFERENCES e_wallets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('profit', 'from_trading', 'to_trading', 'transfer_in', 'transfer_out')),
  amount      NUMERIC NOT NULL,           -- + into the e-wallet, − out of it
  is_paper    BOOLEAN NOT NULL DEFAULT true,
  order_id    UUID,
  rule_id     UUID,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS e_wallet_entries_wallet_idx ON e_wallet_entries (wallet_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS e_wallet_entries_once_idx ON e_wallet_entries (rule_id, order_id) WHERE rule_id IS NOT NULL AND order_id IS NOT NULL;
