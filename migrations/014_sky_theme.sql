-- Brand accent: sky blue on black.
ALTER TABLE user_profiles ALTER COLUMN avatar_color SET DEFAULT '#38bdf8';
UPDATE user_profiles SET avatar_color = '#38bdf8' WHERE lower(avatar_color) IN ('#14c3bb', '#7c5cff', '#4cae4f');
