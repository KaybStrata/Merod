-- Master "Bot trading" switch: off = no bot, AI bot, Auton or auto-switch trades at all, without changing each
-- bot's own on/off (turning it back on resumes exactly the bots that were on). Prompts and manual orders aren't affected.
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS bot_trading BOOLEAN NOT NULL DEFAULT true;
