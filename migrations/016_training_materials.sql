-- "Teach Merod": files, pictures, videos and links a user gives the AI to learn trading lessons from.
CREATE TABLE IF NOT EXISTS training_materials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('document','image','video','article','youtube','text')),
  title          TEXT NOT NULL,
  source_url     TEXT,
  mime           TEXT,
  size_bytes     INT NOT NULL DEFAULT 0,
  content        BYTEA,                -- the uploaded file itself (files only; capped in the app)
  text_content   TEXT,                 -- text read from the file or page (capped)
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','learned','saved','error')),
  status_detail  TEXT,
  summary        TEXT,
  lessons        JSONB NOT NULL DEFAULT '[]',
  symbols        TEXT[] NOT NULL DEFAULT '{}',
  tags           TEXT[] NOT NULL DEFAULT '{}',
  learned_by     TEXT,                 -- e.g. "anthropic:claude-opus-5-5" or "merod:rules"
  active         BOOLEAN NOT NULL DEFAULT true,  -- use these lessons in trading
  attempts       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS training_materials_user_idx ON training_materials (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS training_materials_queue_idx ON training_materials (created_at) WHERE status = 'queued';
