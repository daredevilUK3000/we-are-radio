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

-- Seed the six planned channels (five start in `building`, Kizzi Radio starts `live`)
INSERT OR IGNORE INTO channels (id, slug, name, emoji, description, status, created_at) VALUES
  ('ch_kizzi_radio',       'kizzi-radio',       'Kizzi Radio',        '🎙️', 'Main, personality-driven station', 'live',     datetime('now')),
  ('ch_kizzi_rock',        'kizzi-rock',        'Kizzi Rock',         '🎸', 'Rock material',                     'building', datetime('now')),
  ('ch_kizzi_love',        'kizzi-love',        'Kizzi Love',         '❤️', 'Romantic music',                    'building', datetime('now')),
  ('ch_kizzi_after_dark',  'kizzi-after-dark',  'Kizzi After Dark',   '🌙', 'Slower, atmospheric material',      'building', datetime('now')),
  ('ch_kizzi_instrumental','kizzi-instrumental','Kizzi Instrumental', '🎼', 'Instrumental material',             'building', datetime('now')),
  ('ch_kizzi_archive',     'kizzi-archive',     'The Kizzi Archive',  '📻', 'Older recordings, stories, interviews, career material', 'building', datetime('now'));
