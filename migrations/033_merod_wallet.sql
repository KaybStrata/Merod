-- Merod Wallet: an owner-only Solana hot wallet whose key Merod holds (encrypted with MEROD_MASTER_KEY) so
-- real Jupiter swaps can be signed automatically. Keys live in their own table, never in account metadata or logs.
CREATE TABLE IF NOT EXISTS merod_wallet_keys (
  account_id   UUID PRIMARY KEY REFERENCES trading_accounts(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL UNIQUE,
  enc_secret   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
