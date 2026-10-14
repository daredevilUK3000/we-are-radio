-- Book of the Month (handoff 14 Oct 2026): each month one of Kizzi's books,
-- with a ~5-minute radio segment that airs once or twice a day for the month.
-- The segment airs only through the Scheduler: the Studio form writes draft
-- blocks (a playlist of the jingle then the segment) into the working copy,
-- and Kizzi publishes them the normal way. Links, covers and short links
-- work as house promos do (0026); on-demand listening as the AFG previews (0022).
--
-- Additive only, as 0022 and 0026.
--
--   month             YYYY-MM, one book per month
--   cover_url         R2 key, uploaded in the Studio
--   buy_url           https only; the players link to it through /go/<slug>
--   slug              weareradio.app/go/<slug> and /books/<slug>; also unique
--                     against promos.slug (checked in code, both ways)
--   segment_asset_id  the segment, an audio asset of type 'feature'
--   jingle_asset_id   optional: the sung "Book of the Month" jingle, also a
--                     'feature', so it never joins the jingle rotation
--   list_id           the Scheduler playlist (sched_lists) holding the jingle
--                     and the segment; the book's blocks are the blocks using it
--   airings_json      the form's "When it airs" settings, to reopen it as left
--   status            draft, scheduled (its airings are in a published plan),
--                     archived (kept on /books, short link still works)

CREATE TABLE IF NOT EXISTS books (
  id                TEXT PRIMARY KEY,
  month             TEXT NOT NULL,
  title             TEXT NOT NULL,
  author            TEXT NOT NULL DEFAULT 'Kizzi Nkwocha',
  blurb             TEXT NOT NULL DEFAULT '',
  cover_url         TEXT,
  buy_url           TEXT,
  buy_label         TEXT NOT NULL DEFAULT 'Get the book',
  slug              TEXT NOT NULL,
  segment_asset_id  TEXT REFERENCES audio_assets(id),
  jingle_asset_id   TEXT REFERENCES audio_assets(id),
  list_id           TEXT,
  airings_json      TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','archived')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_month ON books(month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_slug ON books(slug);

-- Clicks through /go/<slug> for a book: which book, from where, when. Nothing
-- about the listener. A sibling of promo_clicks rather than rows in it:
-- promo_clicks.source has a CHECK that can't be widened in place, and books
-- add two sources (the landing card and /books).
CREATE TABLE IF NOT EXISTS book_clicks (
  id         INTEGER PRIMARY KEY,
  book_id    TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('player','just_played','tv','direct','page','books')),
  timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_clicks_book ON book_clicks(book_id, timestamp);

-- "Listen now" on the landing card and /books: an on-demand play of the
-- segment, never a station play (as afg_preview_events in 0022).
CREATE TABLE IF NOT EXISTS book_preview_events (
  id         INTEGER PRIMARY KEY,
  book_id    TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('page','books')),
  timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_preview_book ON book_preview_events(book_id, timestamp);
