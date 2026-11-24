-- Admin: per-provider pricing used for API cost ESTIMATES on the admin dashboard.
-- Kept in its own table (not provider_configs.settings) because saving provider URL settings
-- replaces that JSON object and would silently wipe the pricing entry.
CREATE TABLE IF NOT EXISTS provider_pricing (
  provider_id   TEXT PRIMARY KEY,
  cost_per_1k   NUMERIC NOT NULL CHECK (cost_per_1k >= 0),   -- USD per 1,000 requests (admin-entered estimate)
  updated_by    UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_logs(action, id DESC);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
