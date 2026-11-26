-- Files attached in the prompt box (Classic and Talk) reuse the Teach Merod reader (PDF, images, text, video) but are kept
-- apart: 'chat' attachments only inform the prompt they were sent with — they don't join the Teach Merod library, the
-- always-on study notes, or the AI Learning feed.
ALTER TABLE training_materials ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'teach';
DO $$ BEGIN
  ALTER TABLE training_materials ADD CONSTRAINT training_materials_origin_check CHECK (origin IN ('teach', 'chat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
