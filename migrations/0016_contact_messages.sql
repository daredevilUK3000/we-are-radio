-- Messages from the /contact page. Stored so the Studio inbox (a later
-- piece of work) can list them; for now each one is also emailed to the
-- studio. Retention: deleted after 24 months (see /privacy).
CREATE TABLE IF NOT EXISTS contact_messages (
  id              TEXT PRIMARY KEY,           -- newId('msg')
  topic           TEXT NOT NULL CHECK (topic IN ('studio','request','top3','business','press','problem')),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  email_hash      TEXT NOT NULL,
  fields_json     TEXT,                        -- the topic's extra fields, e.g. {"song":"...","dedicate_to":"..."}
  message         TEXT NOT NULL,
  on_air_ok       INTEGER NOT NULL DEFAULT 0,
  page_ref        TEXT,                        -- where they came from, if on weareradio.app
  user_agent      TEXT,                        -- trimmed to 200 chars; helps with "problem" reports
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied','archived','spam')),
  emailed         INTEGER NOT NULL DEFAULT 0,  -- 1 once the studio notification was accepted by the email provider
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status, created_at);
