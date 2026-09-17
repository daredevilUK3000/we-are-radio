-- Favourites and listening history (Sections 22/23/28 of the brief).
-- Deliberately added only now that the core catalogue/programme tables have
-- been used through a real publish cycle - see the deferral note in
-- 0001_init.sql's design discussion (We_Are_Radio_Brief_v3.md Section 33).
--
-- There is a single listener account (Kizzi, across her own devices - see
-- the login work in worker/src/routes/listenerAuth.ts), so neither table
-- carries a user_id: everything belongs to that one listener.

CREATE TABLE IF NOT EXISTS favourites (
  id          TEXT PRIMARY KEY,
  item_type   TEXT NOT NULL CHECK (item_type IN ('track','album','programme')),
  item_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (item_type, item_id)
);

CREATE TABLE IF NOT EXISTS listening_history (
  id          TEXT PRIMARY KEY,
  item_type   TEXT NOT NULL CHECK (item_type IN ('track','programme')),
  item_id     TEXT NOT NULL,
  played_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listening_history_played_at ON listening_history(played_at DESC);
