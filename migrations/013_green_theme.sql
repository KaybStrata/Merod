-- Brand color: turquoise fading into orange.
ALTER TABLE user_profiles ALTER COLUMN avatar_color SET DEFAULT '#14c3bb';
UPDATE user_profiles SET avatar_color = '#14c3bb' WHERE lower(avatar_color) IN ('#7c5cff', '#4cae4f');
