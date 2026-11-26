-- Force trading: auto trading places real orders without waiting for the theoretical record or confidence bar.
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS force_trading BOOLEAN NOT NULL DEFAULT false;
