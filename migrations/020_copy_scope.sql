-- Optional market scope on a mimic bot (e.g. only Solana meme coins), set when it's created from a prompt.
ALTER TABLE copy_follows ADD COLUMN IF NOT EXISTS scope JSONB;
