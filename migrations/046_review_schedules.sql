-- Scheduled performance reviews: Daily / Weekly / Monthly or a custom length set with the dial ("every N"), minimum 1 hour.
CREATE TABLE IF NOT EXISTS review_schedules (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  every_sec  INTEGER NOT NULL CHECK (every_sec >= 3600),
  next_at    TIMESTAMPTZ NOT NULL,
  email      BOOLEAN NOT NULL DEFAULT false,
  last_at    TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_schedules_due_idx ON review_schedules (next_at);
