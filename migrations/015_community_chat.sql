-- Community chat: one public room shared by every Merod user.
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  reply_to    BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_live_idx ON chat_messages (id DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_mutes (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted_until  TIMESTAMPTZ NOT NULL,
  reason       TEXT,
  muted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_reports (
  id           BIGSERIAL PRIMARY KEY,
  message_id   BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_id)
);
