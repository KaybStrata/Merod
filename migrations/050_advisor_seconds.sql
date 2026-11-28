-- Advisor can check as often as every 30 seconds (was minutes). Everyone moves to 30 seconds.
ALTER TABLE advisor_settings ADD COLUMN IF NOT EXISTS every_sec INTEGER NOT NULL DEFAULT 30;
DO $$ BEGIN
  ALTER TABLE advisor_settings ADD CONSTRAINT advisor_settings_every_sec_check CHECK (every_sec >= 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE advisor_settings SET every_sec = 30, next_run_at = LEAST(next_run_at, now() + interval '30 seconds');
