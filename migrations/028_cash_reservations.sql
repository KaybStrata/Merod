-- Account-level buying-power reservations (spec §03 "Capital and concurrency").
-- A reservation counts only while its order is open; cancel/reject/fill release it, partial fills shrink it.
CREATE TABLE IF NOT EXISTS cash_reservations (
  order_id    UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES trading_accounts(id) ON DELETE CASCADE,
  amount      NUMERIC(24,8) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_reservations_account_idx ON cash_reservations (account_id);
