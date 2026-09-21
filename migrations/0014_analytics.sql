-- Analytics, ahead of the public launch push (handoff: Analytics).
--
-- Two separate jobs:
--   1. listening_events - what people play, finish and skip (the station itself).
--   2. site_events      - visits and a visit -> Listen Now -> played funnel (reach).
--
-- Both are aggregate only: there are no accounts and nothing here identifies a
-- person. listening_events carries no listener or session identifier at all.
-- site_events carries a random per-browser-tab id purely so one visit can be
-- counted once; it is never stored on the device beyond that tab and is never
-- joined to listening_events.
--
-- Plain INTEGER primary keys (no separate id index) and a single timestamp index
-- each, because D1 bills every index update as another row written and these
-- tables take a write for every song someone plays. Additive only.

CREATE TABLE IF NOT EXISTS listening_events (
  id                INTEGER PRIMARY KEY,
  event_type        TEXT NOT NULL CHECK (event_type IN ('play_started', 'play_completed', 'play_skipped')),
  -- What was actually playing. A 'channel' event means someone tuned in.
  content_type      TEXT NOT NULL CHECK (content_type IN ('track', 'programme', 'channel')),
  -- The track / programme / channel row. NULL for a Radio That Knows You programme:
  -- it is built on the spot for one listener, so there is no row to point at.
  content_id        TEXT,
  channel_id        TEXT,
  -- Only set for plays that came from a Radio That Knows You session: the need
  -- picked (energy | love | switch-off | fun). Checked in code against needs.ts,
  -- not here, so adding a fifth need never needs a migration.
  mood              TEXT,
  -- Where the play happened, so skip rates for a channel aren't blended with
  -- an album someone chose on purpose.
  source            TEXT NOT NULL CHECK (source IN ('channel', 'album', 'programme', 'my-mood', 'radio-for-you')),
  -- 1 when the song was a wildcard (the surprise pick) in a Radio That Knows You programme.
  is_wildcard       INTEGER,
  -- How far in they were when it ended or was left (seconds). Tells an instant
  -- skip from a song abandoned in the last minute.
  listened_seconds  INTEGER,
  timestamp         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listening_events_timestamp ON listening_events(timestamp);

CREATE TABLE IF NOT EXISTS site_events (
  id          INTEGER PRIMARY KEY,
  -- visit: the app was opened. listen_now: the Listen Now button was pressed.
  -- first_play: something was played for the first time in that visit.
  event_type  TEXT NOT NULL CHECK (event_type IN ('visit', 'listen_now', 'first_play')),
  session_id  TEXT NOT NULL,
  -- Where the visit came from: utm_source if the link had one (e.g. ?utm_source=youtube),
  -- else the referring site's name, else 'direct'.
  source      TEXT,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_events_timestamp ON site_events(timestamp);
