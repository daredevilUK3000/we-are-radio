-- "Start over" in the radio players (handoff_player_upgrades.md §1.5): one row
-- each time a listener restarts the song on air for themselves. Aggregate only,
-- like listening_events: no listener or session id. A separate table because
-- listening_events.event_type has a CHECK constraint, and widening it would
-- mean rebuilding that busy table. A replay never logs a second play.
CREATE TABLE IF NOT EXISTS listener_restarts (
  id          INTEGER PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  track_id    TEXT NOT NULL,
  seconds_in  INTEGER NOT NULL,   -- how far into the song they were when they restarted it
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listener_restarts_timestamp ON listener_restarts(timestamp);
