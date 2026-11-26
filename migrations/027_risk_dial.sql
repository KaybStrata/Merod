-- Risk taking: a dial (1-100) that scales auto/Modo trade size and take-profit/stop-loss width when risk mode is on.
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS risk_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS risk_level INT NOT NULL DEFAULT 25 CHECK (risk_level BETWEEN 1 AND 100);
