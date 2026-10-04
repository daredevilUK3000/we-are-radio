-- Player health (4 Oct 2026): a listener's radio player tells us when its
-- audio got stuck and what it did about it, so a "the music just stopped"
-- report can be traced to a cause (a dropped connection, a decode error, the
-- phone pausing it...) instead of guessed at. Aggregate only, like 0014: no
-- listener or session id. Its own table, as tv_events in 0021 (site_events has
-- a CHECK on event_type).
--
--   event_type  stall | error | recovered | gave_up
--   detail      small JSON from the browser: readyState, networkState, error
--               code, how long it was stuck, whether a jingle was over it,
--               whether the page was visible
--
-- Takes 0023, which the Scheduler Release 2 plan had pencilled in; that moves to 0024.

CREATE TABLE IF NOT EXISTS player_events (
  id          INTEGER PRIMARY KEY,
  event_type  TEXT NOT NULL,
  channel_id  TEXT,
  item_label  TEXT,
  detail      TEXT,
  user_agent  TEXT,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_events_timestamp ON player_events(timestamp);
