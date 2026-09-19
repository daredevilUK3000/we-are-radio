-- Jingles pinned to a specific song: every time that song plays, the jingle
-- plays over it (the music dips underneath while it speaks), starting
-- start_offset_seconds into the song. A jingle can be pinned to several songs
-- and a song can carry several jingles. These are in addition to the regular
-- jingles the station rotates in between songs. Purely additive.
CREATE TABLE IF NOT EXISTS track_jingles (
  id                   TEXT PRIMARY KEY,
  track_id             TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  audio_asset_id       TEXT NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
  start_offset_seconds INTEGER NOT NULL DEFAULT 4,
  created_at           TEXT NOT NULL,
  UNIQUE (track_id, audio_asset_id)
);
CREATE INDEX IF NOT EXISTS idx_track_jingles_track ON track_jingles(track_id);
CREATE INDEX IF NOT EXISTS idx_track_jingles_asset ON track_jingles(audio_asset_id);
