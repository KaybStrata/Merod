-- Which Talk tab (conversation) created which bot / fleet / agent, so each tab has its own activity and P&L.
-- Orders placed from a prompt already point at the prompt message (orders.source_ref), which belongs to a conversation.
CREATE TABLE IF NOT EXISTS conversation_links (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('bot', 'agent', 'fleet')),
  ref_id           UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS conversation_links_user_idx ON conversation_links (user_id, conversation_id);
