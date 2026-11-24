-- Super admin role + platform fee configuration (performance / commission fee).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin','compliance','support','super_admin'));

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Default: 7% performance fee on realized profit of closing trades (no fee on losses).
INSERT INTO platform_settings (key, value) VALUES ('fees', '{"mode":"performance","pct":7}') ON CONFLICT (key) DO NOTHING;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_usd NUMERIC NOT NULL DEFAULT 0;
