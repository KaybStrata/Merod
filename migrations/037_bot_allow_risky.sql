-- Per-bot switch: let this bot's buys through the token-screening, minimum-liquidity and slippage checks instead of rejecting them.
ALTER TABLE trading_bots ADD COLUMN IF NOT EXISTS allow_risky BOOLEAN NOT NULL DEFAULT false;
