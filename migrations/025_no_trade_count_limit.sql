-- Bots no longer have a daily trade-count limit (budget, daily spend and daily loss limits still apply).
ALTER TABLE trading_bots ALTER COLUMN max_trades_per_day DROP NOT NULL;
ALTER TABLE trading_bots ALTER COLUMN max_trades_per_day DROP DEFAULT;
UPDATE trading_bots SET max_trades_per_day = NULL;
