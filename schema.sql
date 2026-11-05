CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  from_addr TEXT,
  from_name TEXT,
  subject TEXT,
  text TEXT,
  html TEXT,
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mailbox_created ON messages (mailbox, created DESC);
