-- New channels from the Studio, and places on songs (handoff 23 Oct 2026,
-- for We Are WanderLust). What used to be hard-coded per slug in the app
-- (accent colour, card still and clip, label) now lives on the channel row,
-- so a channel created in the Studio looks finished. Songs can carry the
-- city they're about, shown under the title while they play.
--
-- Additive only. The seeds below are exactly what each channel used before
-- (channelAccent.ts, guide.ts, app/public/channels/), so nothing changes.
--
--   accent          hex colour; NULL = the neutral grey, as before
--   card_image      the still for the channel card and TV backgrounds:
--                   "/channels/..." is a file in the app, anything else an R2 key
--   card_video      the looping clip on the card and Listen page, same rule; optional
--   short_label     optional, for tight spots when the name is too long
--   in_coming_soon  1 = a building channel counts in the landing page's
--                   "+N more coming soon" tile (only the number is public)
--   place_city / place_country / place_timezone (tracks)
--                   e.g. Shanghai / China / Asia/Shanghai; all optional

ALTER TABLE channels ADD COLUMN accent TEXT;
ALTER TABLE channels ADD COLUMN card_image TEXT;
ALTER TABLE channels ADD COLUMN card_video TEXT;
ALTER TABLE channels ADD COLUMN short_label TEXT;
ALTER TABLE channels ADD COLUMN in_coming_soon INTEGER NOT NULL DEFAULT 1;

ALTER TABLE tracks ADD COLUMN place_city TEXT;
ALTER TABLE tracks ADD COLUMN place_country TEXT;
ALTER TABLE tracks ADD COLUMN place_timezone TEXT;

UPDATE channels SET accent = '#E11D2E' WHERE slug IN ('kizzi-radio', 'we-are-love');
UPDATE channels SET accent = '#F5B942' WHERE slug = 'we-are-50s';
UPDATE channels SET accent = '#3E7CB1' WHERE slug = 'we-are-after-dark';

UPDATE channels
SET card_image = '/channels/channel-' || slug || '.jpg', card_video = '/channels/channel-' || slug || '.mp4'
WHERE slug IN ('kizzi-radio', 'we-are-50s', 'we-are-love', 'we-are-after-dark', 'we-are-instrumental');

-- Kizzi's call (23 Oct): the two talk channels in building don't count towards
-- "+N more coming soon", so the tile still reads "+1" (We Are Archive).
UPDATE channels SET in_coming_soon = 0 WHERE slug IN ('friday-game-changers', 'lets-talk');
