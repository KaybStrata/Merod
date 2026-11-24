-- Modo Autopilot: Modo scans news + markets and trades on its own, learning from every result.
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS modo_autopilot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS modo_min_confidence NUMERIC NOT NULL DEFAULT 0.5;
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS modo_last_run_at TIMESTAMPTZ;
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS modo_thoughts JSONB NOT NULL DEFAULT '[]';
ALTER TABLE auto_trades ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto','modo'));
