-- Advertising For Good (handoff_advertising_for_good.md): short ads that sell
-- nothing - be kind, check on a neighbour, keep faith. They already air as
-- ordinary jingles; this makes them visible on the site (/good, the landing
-- page) without changing how they air. Additive only: plain columns on
-- audio_assets, so the type CHECK constraint (and the jingle rotation, which
-- picks by type) is untouched.
--
--   afg            1 = an Advertising For Good ad
--   afg_slug       its public link, /good/<slug>; set once and kept when the
--                  ad is retitled, so links already shared keep working
--   afg_order      display order on the site (ascending)
--   afg_featured   the one ad in the landing page's "Hear one" player
--   afg_published  shown on the site. Separate from status, which decides
--                  whether it airs: taking an ad off the site never takes it
--                  off air. The site only lists ads that are both.
--
-- Takes 0022, which the Scheduler Release 2 plan had pencilled in; that moves to 0023.

ALTER TABLE audio_assets ADD COLUMN afg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audio_assets ADD COLUMN afg_slug TEXT;
ALTER TABLE audio_assets ADD COLUMN afg_order INTEGER;
ALTER TABLE audio_assets ADD COLUMN afg_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audio_assets ADD COLUMN afg_published INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_assets_afg_slug ON audio_assets(afg_slug) WHERE afg_slug IS NOT NULL;
-- Exactly one featured at a time: a second row with afg_featured = 1 is refused.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_assets_afg_featured ON audio_assets(afg_featured) WHERE afg_featured = 1;
CREATE INDEX IF NOT EXISTS idx_audio_assets_afg ON audio_assets(afg, afg_order);

-- Previews played on the site (not station plays: they never touch
-- listening_events, Just played, likes or the Top 3). Aggregate only, like 0014.
-- Their own table, as tv_events in 0021: site_events.event_type has a CHECK
-- constraint that can't take new values without a table rebuild.
CREATE TABLE IF NOT EXISTS afg_preview_events (
  id              INTEGER PRIMARY KEY,
  audio_asset_id  TEXT NOT NULL,
  timestamp       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_afg_preview_events_asset ON afg_preview_events(audio_asset_id, timestamp);

-- The thirteen ads Kizzi uploaded as jingles on 2 Oct 2026, with their titles
-- tidied (Kizzi, 2 Oct). Knock on a door is featured. The alternate take
-- "Knock on Door-David" (aa_d1a9...) keeps airing but isn't on the site.
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_featured = 1, afg_order = 1,  afg_slug = 'knock-on-a-door',       title = 'Knock on a door'       WHERE id = 'aa_432bceda119a4085b189a2373cf5baa4';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 2,  afg_slug = 'be-kind',               title = 'Be kind'               WHERE id = 'aa_b0540eac3fb24119a61f412b2423806c';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 3,  afg_slug = 'notice-someone',        title = 'Notice someone'        WHERE id = 'aa_38060a20499647fc912e29ef13a188b3';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 4,  afg_slug = 'five-minutes',          title = 'Five minutes'          WHERE id = 'aa_52ac21b92d304050ac255582ee3e9387';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 5,  afg_slug = 'put-the-phone-down',    title = 'Put the phone down'    WHERE id = 'aa_677fd65b68864a1498218f8796dc8b74';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 6,  afg_slug = 'give-someone-a-chance', title = 'Give someone a chance' WHERE id = 'aa_1097087cf6cd4361bbc3e6fee1410828';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 7,  afg_slug = 'elderly',               title = 'Elderly'               WHERE id = 'aa_d2db3d1c199449799d331c6d6c4034ca';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 8,  afg_slug = 'hope',                  title = 'Hope'                  WHERE id = 'aa_bcb402d15f6d4deeacdef004878184ca';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 9,  afg_slug = 'vulnerable',            title = 'Vulnerable'            WHERE id = 'aa_b8b1d89943c247bbb66f6e50eafad3a6';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 10, afg_slug = 'the-power-of-words',    title = 'The power of words'    WHERE id = 'aa_82480cc921e949d5a7fd8d0ad5fd0484';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 11, afg_slug = 'optimism',              title = 'Optimism'              WHERE id = 'aa_5b655337ee1345249f2fd0b713aa4b81';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 12, afg_slug = 'gratitude',             title = 'Gratitude'             WHERE id = 'aa_cd83b87d98f54e319c2ad24eaa51d0f6';
UPDATE audio_assets SET afg = 1, afg_published = 1, afg_order = 13, afg_slug = 'listening',             title = 'Listening'             WHERE id = 'aa_bb73c48cce17423ba28f7fdb4ea66e83';
