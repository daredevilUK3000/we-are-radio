-- We Are Radio on TV (handoff_tv_firetv.md §A11). Aggregate only, as 0014:
-- no listener or session id.
--
-- platform: where a play happened - 'firetv' (the Fire TV app), 'tv' (/tv in
-- any other TV browser), NULL for the ordinary site. Added as a plain column:
-- listening_events' CHECK constraints are on other columns and untouched.
ALTER TABLE listening_events ADD COLUMN platform TEXT;

-- TV-only moments: tv_open, tv_channel_change, tv_lean_back,
-- tv_shout_out_qr_shown. Their own table, because site_events.event_type has
-- a CHECK constraint that can't take new values without a table rebuild.
CREATE TABLE IF NOT EXISTS tv_events (
  id          INTEGER PRIMARY KEY,
  event_type  TEXT NOT NULL,
  platform    TEXT NOT NULL,
  channel_id  TEXT,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tv_events_timestamp ON tv_events(timestamp);
