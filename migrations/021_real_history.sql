-- When real chart history was last pulled for an asset (real-data-only mode).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS history_backfilled_at TIMESTAMPTZ;
