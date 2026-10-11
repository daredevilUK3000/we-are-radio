-- House promos (handoff_house_promos.md, 11 Oct 2026): short promos for the
-- books Kizzi publishes and his platforms, each with a link the players show
-- while it plays (a button; a QR code on the TV). They come out of the jingle
-- pool and air only through their own rotation (lib/promos.ts).
--
-- Additive only, as 0022: a side table keyed by the asset, so audio_assets
-- and its type CHECK constraint are untouched. A promo with no row here is
-- simply not set up yet, and never airs.
--
--   on_air_title   what the players show
--   link_url       where the button and the QR code go (https only)
--   link_label     the button, e.g. "Get the book"
--   slug           the short link, weareradio.app/go/<slug>
--   cover_url      R2 key of a book cover or logo (optional)
--   active         off = never airs. New promos start off.
--   runs_from/to   optional Paris dates, inclusive
--   max_per_day    plays per Paris day, across all channels
--   channel_ids    JSON array of channel ids; NULL = every live channel

CREATE TABLE IF NOT EXISTS promos (
  audio_asset_id  TEXT PRIMARY KEY REFERENCES audio_assets(id) ON DELETE CASCADE,
  on_air_title    TEXT,
  link_url        TEXT,
  link_label      TEXT NOT NULL DEFAULT 'Find out more',
  slug            TEXT,
  cover_url       TEXT,
  active          INTEGER NOT NULL DEFAULT 0,
  runs_from       TEXT,
  runs_to         TEXT,
  max_per_day     INTEGER NOT NULL DEFAULT 4,
  channel_ids     TEXT,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promos_slug ON promos(slug) WHERE slug IS NOT NULL;

-- Station-wide settings. promos_per_hour: the most promos per clock hour on
-- each channel (0-3); 0 stops every promo without switching each one off.
CREATE TABLE IF NOT EXISTS station_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
INSERT OR IGNORE INTO station_settings (key, value, updated_at) VALUES ('promos_per_hour', '1', '2026-10-11T00:00:00.000Z');

-- Clicks through /go/<slug>: which promo, from where, when. Nothing about the
-- listener, like 0014. A sibling of outbound_clicks (0024) rather than rows
-- in it, so the makers' figures stay theirs.
CREATE TABLE IF NOT EXISTS promo_clicks (
  id              INTEGER PRIMARY KEY,
  audio_asset_id  TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('player','just_played','tv','direct')),
  timestamp       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_clicks_asset ON promo_clicks(audio_asset_id, timestamp);

-- "Listen Now" (uploaded 18 Sep as a promo) is a station promo with no link
-- and has aired as a jingle since 30 Sep. Kizzi (11 Oct): keep it airing as
-- it does now, so it becomes a jingle. It stays in the jingle pool, so the
-- rotation doesn't change.
UPDATE audio_assets SET type = 'jingle' WHERE id = 'aa_7a8bdca3673a4d8780d2ee9aed017c2c' AND type = 'promo';
