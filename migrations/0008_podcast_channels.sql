-- Two channels to import podcast shows into. They start in `building` (like
-- the other unlaunched channels): podcast episodes reach listeners through the
-- Podcasts section, not the live-radio channel grid, so these never need to be
-- `live` - and staying out of that grid keeps them from showing up as radio
-- stations. `manual` because a podcast channel isn't autopilot-programmed.
INSERT OR IGNORE INTO channels (id, slug, name, emoji, description, status, programming_mode, created_at) VALUES
  ('ch_friday_game_changers', 'friday-game-changers', 'Friday Game Changers', '⚡', 'Kizzi''s Friday Game Changers podcast', 'building', 'manual', datetime('now')),
  ('ch_lets_talk',            'lets-talk',            'Let''s Talk',          '💬', 'Let''s Talk With Kizzi podcast',       'building', 'manual', datetime('now'));
