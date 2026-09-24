-- Top 3 Creator Songs of 2026 - entry phase (Phase A), plus public Likes.
--
-- Entrant contact details live in their own table so no public query ever
-- touches them. Entries use an INTEGER id because it IS the public song
-- number ("Song #127"); numbering starts at 101 (see the insert in
-- routes/contest.ts) so no song looks like it is ranked #1.
--
-- An entry starts 'unconfirmed' until the entrant clicks the link in the
-- confirmation email (proving the address works - winners must be
-- reachable), then waits as 'pending' for the Studio to review it.
--
-- likes outlives the competition: listeners can like ordinary tracks and
-- contest songs; only the Studio ever sees counts. Voting tables (rounds,
-- votes, voters, judges) are Phase B and deliberately not created here.
--
-- Timestamps are ISO strings, like the rest of the database. Additive only.

CREATE TABLE IF NOT EXISTS contest_entrants (
  id          TEXT PRIMARY KEY,              -- newId('ent')
  legal_name  TEXT NOT NULL,
  email       TEXT NOT NULL,                 -- as typed, to contact them; never published
  email_hash  TEXT NOT NULL UNIQUE,          -- HMAC of the normalised email (lib/hash.ts)
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contest_entries (
  id                   INTEGER PRIMARY KEY,  -- public song number, from 101
  entrant_id           TEXT NOT NULL REFERENCES contest_entrants(id),
  title                TEXT NOT NULL,
  creator_name         TEXT NOT NULL,
  country_code         TEXT NOT NULL,        -- ISO 3166-1 alpha-2, upper case
  created_or_released  TEXT NOT NULL,        -- YYYY-MM-DD, must fall in 2026
  ai_tools             TEXT,                 -- free text; NULL = entrant declared none
  collecting_society   TEXT,                 -- e.g. 'SACEM'; NULL = not a member
  bio                  TEXT,                 -- up to 300 chars
  links_json           TEXT,                 -- JSON array, up to 3 https URLs
  photo_key            TEXT,                 -- R2 key under contest/{pending|approved|removed}/
  audio_key            TEXT NOT NULL,        -- R2 key under contest/{pending|approved|removed}/
  audio_bytes          INTEGER NOT NULL,
  duration_seconds     INTEGER,              -- reported by the browser; reviewer confirms
  status               TEXT NOT NULL DEFAULT 'unconfirmed'
                         CHECK (status IN ('unconfirmed','pending','approved','rejected','disqualified','withdrawn')),
  status_reason        TEXT,                 -- shown to the entrant on rejection
  confirm_token_hash   TEXT,                 -- HMAC of the emailed token; prefixed 'used:' once used
  confirmed_at         TEXT,
  reviewed_at          TEXT,
  approved_at          TEXT,
  library_track_id     TEXT,                 -- set by "Add to library"
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contest_entries_status ON contest_entries(status, country_code);
CREATE INDEX IF NOT EXISTS idx_contest_entries_entrant ON contest_entries(entrant_id);

CREATE TABLE IF NOT EXISTS contest_notify (
  id                 TEXT PRIMARY KEY,       -- newId('ntf')
  email              TEXT NOT NULL,
  email_hash         TEXT NOT NULL UNIQUE,
  source_entry_id    INTEGER,                -- song page they signed up from, if any
  wants_voting_alert INTEGER NOT NULL DEFAULT 1,
  wants_news         INTEGER NOT NULL DEFAULT 0,
  confirm_token_hash TEXT,
  confirmed_at       TEXT,                   -- NULL until they click the email link
  unsubscribed_at    TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contest_audit (
  id          INTEGER PRIMARY KEY,
  actor       TEXT NOT NULL,                 -- 'studio' or 'system'
  action      TEXT NOT NULL,                 -- 'approve', 'reject', 'edit', 'disqualify', ...
  target      TEXT,                          -- e.g. 'entry:127'
  detail_json TEXT,
  created_at  TEXT NOT NULL
);

-- The UNIQUE index also serves "count likes for this item", so no extra index.
CREATE TABLE IF NOT EXISTS likes (
  id          INTEGER PRIMARY KEY,
  item_type   TEXT NOT NULL CHECK (item_type IN ('track','contest_entry')),
  item_id     TEXT NOT NULL,                 -- tracks.id, or contest_entries.id as text
  liker_hash  TEXT NOT NULL,                 -- HMAC of the anonymous liker cookie
  created_at  TEXT NOT NULL,
  UNIQUE (item_type, item_id, liker_hash)
);
CREATE INDEX IF NOT EXISTS idx_likes_created ON likes(created_at);
