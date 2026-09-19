-- How a jingle / station ID is played (handoff: automatic jingle playback).
--
--   sequenced       - plays as its own clip between songs (the behaviour every
--                     jingle had before this migration, and still the default).
--   duck_over_music - the voice plays *over* a song while the music is turned
--                     down for the length of the jingle, then brought back up:
--                     the classic radio "sweeper".
--
-- duck_level is how far the music drops, as a fraction of full volume (0.28 =
-- down to 28%); duck_fade_ms is how long the drop and the recovery each take.
-- Both only matter for duck_over_music. Purely additive, so every existing
-- jingle keeps behaving exactly as it did.
ALTER TABLE audio_assets ADD COLUMN play_mode TEXT NOT NULL DEFAULT 'sequenced'
  CHECK (play_mode IN ('sequenced', 'duck_over_music'));
ALTER TABLE audio_assets ADD COLUMN duck_level REAL NOT NULL DEFAULT 0.28;
ALTER TABLE audio_assets ADD COLUMN duck_fade_ms INTEGER NOT NULL DEFAULT 400;
