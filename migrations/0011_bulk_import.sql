-- Bulk import of tracks (handoff: Studio Bulk Import). Purely additive.
--
-- tracks.artist        - the byline shown for a track (set in bulk on import).
-- tracks.content_hash  - SHA-256 of the audio file's bytes, so a re-import of
--                        an overlapping folder can be recognised as duplicates
--                        by content rather than by (unreliable) filename.
ALTER TABLE tracks ADD COLUMN artist TEXT;
ALTER TABLE tracks ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_tracks_content_hash ON tracks(content_hash);

-- What has been typed into the import grid, saved as you go. A browser can't
-- remember which files were in a folder between visits, so each row is keyed
-- by name + size + modified time: pick the same folder again and every saved
-- title, artist, album, track number and tag reappears on the matching file.
-- Once a file has been uploaded, track_id points at the draft track that was
-- created for it, and edits made here are written through to that track.
CREATE TABLE IF NOT EXISTS import_rows (
  id            TEXT PRIMARY KEY,
  file_key      TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  size_bytes    INTEGER,
  title         TEXT NOT NULL DEFAULT '',
  artist        TEXT,
  album_id      TEXT REFERENCES albums(id) ON DELETE SET NULL,
  track_number  INTEGER,
  tags          TEXT NOT NULL DEFAULT '[]',
  content_hash  TEXT,
  track_id      TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_rows_track ON import_rows(track_id);
