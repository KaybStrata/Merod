-- Auto trading: Merod decides and executes trades from many data points, after testing them theoretically first.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('manual','prompt','shortcut','bot','conditional','system','copy','auto'));

CREATE TABLE IF NOT EXISTS auto_trading (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled          BOOLEAN NOT NULL DEFAULT false,              -- the on/off switch
  account_id       UUID REFERENCES trading_accounts(id) ON DELETE SET NULL,  -- NULL = paper account
  markets          TEXT NOT NULL DEFAULT 'both' CHECK (markets IN ('crypto','stocks','both')),
  trade_usd        NUMERIC NOT NULL DEFAULT 100,                -- size of each auto trade
  max_daily_usd    NUMERIC NOT NULL DEFAULT 500,                -- stops buying for the day once reached
  max_open         INT NOT NULL DEFAULT 5,                      -- most auto positions open at once
  min_confidence   NUMERIC NOT NULL DEFAULT 0.6,
  min_theory_trades INT NOT NULL DEFAULT 5,                     -- theoretical trades needed before any real trade
  min_theory_win_rate NUMERIC NOT NULL DEFAULT 0.55,            -- their win rate needed before real trades
  take_profit_pct  NUMERIC NOT NULL DEFAULT 4,
  stop_loss_pct    NUMERIC NOT NULL DEFAULT 2,
  weights          JSONB NOT NULL DEFAULT '{"merod":1,"thirdParty":1,"modo":1,"backtest":1,"momentum":1}',
  last_run_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auto_trades (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id         UUID NOT NULL REFERENCES assets(id),
  symbol           TEXT NOT NULL,
  side             TEXT NOT NULL CHECK (side IN ('buy','sell')),
  mode             TEXT NOT NULL CHECK (mode IN ('theory','real')),  -- theory = tested on paper only, no order placed
  status           TEXT NOT NULL CHECK (status IN ('open','closed','skipped','failed')),
  signals          JSONB NOT NULL,                                   -- every data point with its value and evidence
  score            NUMERIC NOT NULL,
  confidence       NUMERIC NOT NULL,
  entry_price      NUMERIC,
  exit_price       NUMERIC,
  return_pct       NUMERIC,
  order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  exit_order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  explain_before   TEXT NOT NULL,
  explain_during   TEXT,
  explain_after    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auto_trades_user_idx ON auto_trades (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auto_trades_open_idx ON auto_trades (status) WHERE status = 'open';
