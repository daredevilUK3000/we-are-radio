-- "Radio That Knows You" (handoff): a listener says what they need and gets a
-- produced programme - songs, pre-recorded spoken links from Kizzi, a wildcard,
-- and a name. No AI in the per-listener path: everything is chosen by rules from
-- the catalogue, the spoken-link bank and the title bank below. Additive only.

-- What a spoken link is FOR, so the Radio Brain can place it: opening a
-- programme, bridging two songs, dropping a fun fact, or closing. (Which moods
-- it suits is carried by the tags already on audio assets, like everything else.)
ALTER TABLE audio_assets ADD COLUMN link_kind TEXT
  CHECK (link_kind IN ('intro', 'transition', 'fun_fact', 'observation', 'outro'));

-- Programme names, written per need (and optionally per time of day); one is
-- picked by rule for each programme. Editable in the Studio.
CREATE TABLE IF NOT EXISTS programme_titles (
  id          TEXT PRIMARY KEY,
  need        TEXT NOT NULL,              -- energy | love | switch-off | fun
  title       TEXT NOT NULL,
  time_band   TEXT CHECK (time_band IN ('morning', 'afternoon', 'evening', 'night')),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_programme_titles_need ON programme_titles(need);

-- A starter set. "Friday Night Escape", "A Little Radio for a Long Day" and
-- "Midnight in Your Head" are the examples from the brief; the rest are
-- placeholders to be replaced with Kizzi's own titles in the Studio.
INSERT OR IGNORE INTO programme_titles (id, need, title, time_band, created_at) VALUES
  ('pt_fun_1',    'fun',        'Friday Night Escape',            'evening',   datetime('now')),
  ('pt_fun_2',    'fun',        'Just for the Fun of It',         NULL,        datetime('now')),
  ('pt_fun_3',    'fun',        'The Good Times Hour',            NULL,        datetime('now')),
  ('pt_off_1',    'switch-off', 'A Little Radio for a Long Day',  NULL,        datetime('now')),
  ('pt_off_2',    'switch-off', 'Midnight in Your Head',          'night',     datetime('now')),
  ('pt_off_3',    'switch-off', 'Slow Down With Me',              NULL,        datetime('now')),
  ('pt_love_1',   'love',       'A Little Love Radio',            NULL,        datetime('now')),
  ('pt_love_2',   'love',       'Falling, Slowly',                NULL,        datetime('now')),
  ('pt_love_3',   'love',       'After Dark, With Love',          'night',     datetime('now')),
  ('pt_energy_1', 'energy',     'Get Up and Go',                  'morning',   datetime('now')),
  ('pt_energy_2', 'energy',     'Turn It Up',                     NULL,        datetime('now')),
  ('pt_energy_3', 'energy',     'The Energy Hour',                NULL,        datetime('now'));
