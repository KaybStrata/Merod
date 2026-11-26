-- Spec "Explain & Review" feature 3: "Would you have done this?" ratings on agent trades (one per user + event; re-voting updates).
-- Ratings only add lessons / Auto-Training proposals; they never change an agent's rules, capital or limits by themselves.
CREATE TABLE IF NOT EXISTS agent_trade_feedback (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_id    BIGINT NOT NULL REFERENCES agent_events(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  vote        SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  reasons     TEXT[] NOT NULL DEFAULT '{}', -- good_call | too_risky | bad_timing | wrong_asset | too_big
  note        TEXT CHECK (char_length(note) <= 280),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS agent_trade_feedback_agent_idx ON agent_trade_feedback (agent_id, created_at DESC);
