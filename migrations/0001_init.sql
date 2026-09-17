-- Kizzi Radio - core schema (Section 33 of the brief)
-- Six tables for the first release. schedules / favourites / listening_history
-- are deliberately deferred (see brief).

CREATE TABLE IF NOT EXISTS albums (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  artwork_url   TEXT,
  release_date  TEXT,
  genre         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  album_id              TEXT REFERENCES albums(id),
  track_number          INTEGER,
  duration_seconds      INTEGER NOT NULL,
  audio_url             TEXT NOT NULL,
  artwork_url           TEXT,
  genre                 TEXT,
  subgenre              TEXT,
  energy                TEXT,
  tempo_bpm             INTEGER,
  musical_key           TEXT,
  vocal_or_instrumental TEXT,
  explicit              INTEGER NOT NULL DEFAULT 0,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','processing','ready','published','archived')),
  release_date          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);

CREATE TABLE IF NOT EXISTS channels (
  id              TEXT PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  emoji           TEXT,
  description     TEXT,
  artwork_url     TEXT,
  status          TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building','live')),
  catalogue_rules TEXT, -- JSON
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS programmes (
  id               TEXT PRIMARY KEY,
  channel_id       TEXT NOT NULL REFERENCES channels(id),
  title            TEXT NOT NULL,
  description      TEXT,
  artwork_url      TEXT,
  episode_number   INTEGER,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','preview','published','archived')),
  is_flagship      INTEGER NOT NULL DEFAULT 0,
  publish_date     TEXT,
  duration_seconds INTEGER,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_programmes_channel ON programmes(channel_id);
CREATE INDEX IF NOT EXISTS idx_programmes_status ON programmes(status);

CREATE TABLE IF NOT EXISTS audio_assets (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('station_id','jingle','link','feature','interview','promo')),
  title            TEXT NOT NULL,
  audio_url        TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','processing','ready','published','archived')),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS programme_items (
  id            TEXT PRIMARY KEY,
  programme_id  TEXT NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  item_type     TEXT NOT NULL CHECK (item_type IN ('song','link','station_id','feature','interview')),
  track_id      TEXT REFERENCES tracks(id),
  audio_asset_id TEXT REFERENCES audio_assets(id),
  label         TEXT,
  CHECK (
    (item_type = 'song' AND track_id IS NOT NULL AND audio_asset_id IS NULL)
    OR (item_type != 'song' AND audio_asset_id IS NOT NULL AND track_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_programme_items_programme ON programme_items(programme_id, position);

CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS track_tags (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, tag_id)
);

-- Seed the six planned channels (five start in `building`, Kizzi Radio starts `live`).
-- Only the flagship keeps the "Kizzi" name - it's the one personality-driven,
-- Kizzi-presented channel (We Are Radio brief v3, decision #4). The other five
-- are automatic, tag-curated lenses over the catalogue, not personally hosted,
-- so they carry the network's "We Are ___" naming instead - this also keeps the
-- door open for other presenters later without every channel being tied to Kizzi
-- by name. Row ids/slugs were kept identical to when the channels were still
-- named "Kizzi ___" - only the display name and public slug changed.
INSERT OR IGNORE INTO channels (id, slug, name, emoji, description, status, created_at) VALUES
  ('ch_kizzi_radio',       'kizzi-radio',        'Kizzi Radio',         '🎙️', 'Main, personality-driven station', 'live',     datetime('now')),
  ('ch_kizzi_rock',        'we-are-50s',         'We Are 50s',          '🕺', '1950s-inspired music',              'building', datetime('now')),
  ('ch_kizzi_love',        'we-are-love',        'We Are Love',         '❤️', 'Romantic music',                    'building', datetime('now')),
  ('ch_kizzi_after_dark',  'we-are-after-dark',  'We Are After Dark',   '🌙', 'Slower, atmospheric material',      'building', datetime('now')),
  ('ch_kizzi_instrumental','we-are-instrumental','We Are Instrumental', '🎼', 'Instrumental material',             'building', datetime('now')),
  ('ch_kizzi_archive',     'we-are-archive',     'We Are Archive',      '📻', 'Older recordings, stories, interviews, career material', 'building', datetime('now'));
