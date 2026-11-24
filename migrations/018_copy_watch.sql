-- "Follow" a wallet = watch-only: get notified of its trades without copying them.
ALTER TABLE copy_follows ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'copy';
ALTER TABLE copy_follows DROP CONSTRAINT IF EXISTS copy_follows_mode_check;
ALTER TABLE copy_follows ADD CONSTRAINT copy_follows_mode_check CHECK (mode IN ('copy','watch'));
ALTER TABLE copy_trade_events DROP CONSTRAINT IF EXISTS copy_trade_events_status_check;
ALTER TABLE copy_trade_events ADD CONSTRAINT copy_trade_events_status_check CHECK (status IN ('copied','pending_approval','skipped','failed','watched'));
