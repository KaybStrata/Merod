-- Custom per-trade size, take-profit and stop-loss for auto trading / Modo Autopilot. NULL = use the risk dial.
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS custom_trade_usd NUMERIC;
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS custom_take_profit_pct NUMERIC;
ALTER TABLE auto_trading ADD COLUMN IF NOT EXISTS custom_stop_loss_pct NUMERIC;
