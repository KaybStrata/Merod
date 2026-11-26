-- Talk mode (secondary, toggleable conversation interface). Additive only: Classic stays the default.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS ui_mode_default TEXT NOT NULL DEFAULT 'classic' CHECK (ui_mode_default IN ('classic', 'talk', 'last')),
  ADD COLUMN IF NOT EXISTS ui_last_mode TEXT NOT NULL DEFAULT 'classic' CHECK (ui_last_mode IN ('classic', 'talk')),
  ADD COLUMN IF NOT EXISTS talk_prefs JSONB NOT NULL DEFAULT '{"showSwitch":true,"digest":true,"voice":false,"widgets":["chart","plan","alert","agents","portfolio"]}',
  ADD COLUMN IF NOT EXISTS talk_last_seen_at TIMESTAMPTZ;
