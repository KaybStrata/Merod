-- "Only sell when profitable": one switch for every bot and agent. While on, a sell signal (stop-loss, take-profit,
-- strategy exit) is held until the price is at least min_profit_pct above what was paid (covers fees and slippage).
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS sell_only_in_profit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS min_profit_pct NUMERIC NOT NULL DEFAULT 0.5;
