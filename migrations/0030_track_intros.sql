-- Spoken song intros (handoff_import_intros.md). Additive only.
--
-- An intro is an ordinary 'link' audio asset ("Intro: <song title>", with its
-- script in the description) tied to exactly one song here. Its link_kind is
-- left NULL on purpose: Radio That Knows You only picks links that have a kind,
-- and the Scheduler's voice-link rules and pickers skip any asset in this table,
-- so an intro can only ever play with its own song.
--
--   play_mode 'before' - plays as its own short item, then the song starts
--             'over'   - plays over the song's opening, music dipped, like a
--                        pinned jingle, start_offset_seconds into the song
--   enabled   0 switches the intro off for that song without deleting it
CREATE TABLE IF NOT EXISTS track_intros (
  track_id             TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  audio_asset_id       TEXT NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
  play_mode            TEXT NOT NULL DEFAULT 'before' CHECK (play_mode IN ('before', 'over')),
  start_offset_seconds INTEGER NOT NULL DEFAULT 2,
  enabled              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_track_intros_asset ON track_intros(audio_asset_id);

-- A "before" intro travels with its song's log entry (the song's file_duration_ms
-- includes it), so fitting, trimming and live controls treat the two as one; the
-- read path splits them into two items for the players. NULL for everything else.
ALTER TABLE sched_log_items ADD COLUMN intro_json TEXT;
