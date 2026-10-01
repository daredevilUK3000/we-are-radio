-- "Say it on air": listeners record a short voice note for the station.
-- See handoff_say_it_on_air.md (written as 0018; 0018 was already the
-- shadow grace window, so this is 0019).
--
-- Nothing a listener records is ever broadcast or served publicly until Kizzi
-- has listened to it and approved it in the Studio. The raw recording lives
-- under onair/pending/ in R2, which /media refuses to serve. On approval the
-- prepared audio becomes an ordinary audio_assets row (type 'link',
-- link_kind NULL so Radio That Knows You never picks it up) and is placed on
-- air through the Scheduler's insert_next control.
--
-- Contact details are kept here only to tell the listener when they're on
-- air; public pages never select email or email_hash.
--
-- status flow:
--   pending -> approved -> scheduled -> placed -> aired
--   pending -> rejected | expired | withdrawn
--   approved/scheduled/placed -> withdrawn

CREATE TABLE IF NOT EXISTS onair_messages (
  id                 TEXT PRIMARY KEY,               -- newId('oam')
  public_id          TEXT UNIQUE,                    -- random 10-char slug, set only when a share page exists
  kind               TEXT NOT NULL CHECK (kind IN ('shoutout','dedication','reaction','question')),
  first_name         TEXT NOT NULL,                  -- aired; max 40
  place              TEXT NOT NULL DEFAULT '',       -- "Leeds", aired; optional; max 60
  for_name           TEXT NOT NULL DEFAULT '',       -- dedication: who it's for; max 60
  requested_track_id TEXT REFERENCES tracks(id),     -- dedication: an optional song from the library
  reacting_to_json   TEXT,                           -- reaction: {channel, label, track_id, at} captured when recording started
  note               TEXT NOT NULL DEFAULT '',       -- private note to Kizzi; max 280; never aired or public
  channel_id         TEXT REFERENCES channels(id),   -- where the listener was listening (Kizzi can change it)
  email              TEXT NOT NULL,                  -- for on-air notifications only
  email_hash         TEXT NOT NULL,
  ip_hash            TEXT NOT NULL,
  listener_tz        TEXT,                           -- IANA zone from the browser, to show "your time" in emails
  consent_share      INTEGER NOT NULL DEFAULT 0,     -- ticked "you can share the clip on the web and socials"
  raw_key            TEXT,                           -- onair/pending/<id>.wav ; NULL once deleted
  raw_seconds        REAL NOT NULL,                  -- measured from the WAV header on the server
  audio_asset_id     TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,  -- the prepared, approved audio
  with_intro         INTEGER NOT NULL DEFAULT 0,     -- the prepared audio includes Kizzi's intro (or outro)
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','scheduled','placed','aired','rejected','expired','withdrawn')),
  -- scheduling
  air_channel_id     TEXT REFERENCES channels(id),
  air_after_ms       INTEGER,                        -- place it at the first item boundary at or after this time
  air_when           TEXT,                           -- 'next' | 'at' (how Kizzi asked for it; changes the email wording)
  play_song_after    INTEGER NOT NULL DEFAULT 0,     -- dedication: follow the voice note with requested_track_id
  placed_version     INTEGER,                        -- sched_versions.number that placed it
  placed_airing_id   TEXT,                           -- the voice note's airing_id in that version
  expected_at_ms     INTEGER,                        -- its starts_at_ms in that version (for the email)
  place_attempts     INTEGER NOT NULL DEFAULT 0,     -- failed placements in a row (reset on success)
  scheduled_emailed  INTEGER NOT NULL DEFAULT 0,     -- the "you're going on air" email went out (re-placements don't resend)
  flag               TEXT,                           -- a problem for Kizzi to look at in the inbox ("Couldn't place this: ...")
  song_note          TEXT,                           -- "Their song played recently, so it was left out."
  aired_at_ms        INTEGER,
  -- tokens: HMAC(HASH_PEPPER, "tok:" + token), like the contest
  manage_token_hash  TEXT NOT NULL,                  -- withdraw / listen-back link in every email
  reject_reason      TEXT,
  listened_full      INTEGER NOT NULL DEFAULT 0,     -- set by the Studio when Kizzi reaches the end (§4.2)
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  reviewed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_onair_status ON onair_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_onair_email ON onair_messages(email_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_onair_place ON onair_messages(status, air_after_ms);
CREATE INDEX IF NOT EXISTS idx_onair_asset ON onair_messages(audio_asset_id);

-- Senders Kizzi has blocked. Their future messages are accepted (so they
-- can't tell) and immediately marked rejected with no email.
CREATE TABLE IF NOT EXISTS onair_blocks (
  hash        TEXT PRIMARY KEY,          -- an email_hash or an ip_hash
  kind        TEXT NOT NULL CHECK (kind IN ('email','ip')),
  message_id  TEXT,                      -- the message that led to the block
  created_at  TEXT NOT NULL
);
