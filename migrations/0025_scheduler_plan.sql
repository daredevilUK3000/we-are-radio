-- Scheduler, Release 2 ("Plan"). See Files for Claude/handoff_scheduler_release2.md.
-- Patrick edits a WORKING COPY (sched_blocks, sched_block_exceptions,
-- sched_lists, sched_running_orders and their items). Nothing in it airs.
-- Publishing validates it and writes an immutable snapshot to sched_plans;
-- the generator builds logs only from the latest snapshot per channel.
-- Templates and playlists are embedded in each snapshot, so editing one
-- never changes a published week until it's published again.
--
-- Hand-planned content keeps sched_log_items.source = 'programme', with
-- source_ref prefixes list:<id>, ro:<id> and rule:<list or ro id>:<position>
-- (Release 1's CHECK on source can't be widened in place). Likewise
-- sched_versions.kind stays the coarse category and the new `action` column
-- holds the precise one (publish, plan_rollback, hold, remove...).
--
-- Deviation from the handoff (§1.2): sched_grid_blocks is copied but NOT
-- dropped here. The Worker still running at the moment this migration is
-- applied reads it; dropping it would break the live station until the new
-- code deploys a minute later. It's left empty-and-unused and goes in a
-- later migration. (On 9 Oct 2026 it had no rows anyway.)
--
-- Number: 0025 (0021 TV, 0022 Advertising For Good, 0023 player_events,
-- 0024 outbound_clicks took the earlier ones).

-- Playlists (an ordered list of slots, no times) and templates (slots with
-- offsets from the block start, for shows with a set shape). Station-wide.
CREATE TABLE IF NOT EXISTS sched_lists (
  id            TEXT PRIMARY KEY,                 -- newId('lst')
  kind          TEXT NOT NULL CHECK (kind IN ('playlist','template')),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  length_ms     INTEGER,                          -- template: the show's intended length
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sched_list_slots (
  list_id        TEXT NOT NULL REFERENCES sched_lists(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  slot_kind      TEXT NOT NULL CHECK (slot_kind IN ('fixed','rule','episode')),
  track_id       TEXT REFERENCES tracks(id),       -- fixed
  audio_asset_id TEXT REFERENCES audio_assets(id), -- fixed
  rule_json      TEXT,                             -- rule
  label          TEXT,                             -- "Interview", "Opening jingle"
  at_ms          INTEGER,                          -- template only: fixed offset from the block start; NULL = flows on
  PRIMARY KEY (list_id, position)
);

CREATE TABLE IF NOT EXISTS sched_blocks (
  id              TEXT PRIMARY KEY,               -- Release 1 grid block IDs are kept (sched_log_items.block_id points at them)
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,                  -- the sound, one line; shown on /schedule
  colour          TEXT NOT NULL DEFAULT 'blue' CHECK (colour IN ('blue','purple','gold','green','red','grey')),
  -- WHEN
  recurrence      TEXT NOT NULL DEFAULT 'weekly' CHECK (recurrence IN ('once','weekly','monthly')),
  days_mask       INTEGER,                        -- weekly: bit 0 = Monday ... bit 6 = Sunday
  once_date       TEXT,                           -- once: YYYY-MM-DD (Paris)
  monthly_rule    TEXT,                           -- monthly: {"day":15} or {"nth":1,"weekday":5} (1st Saturday; nth -1 = last)
  date_from       TEXT,                           -- optional season start (inclusive, Paris date)
  date_to         TEXT,                           -- optional season end (inclusive)
  start_min       INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1435),
  end_min         INTEGER NOT NULL CHECK (end_min BETWEEN 5 AND 1440),   -- end <= start: runs past midnight
  layer           INTEGER NOT NULL DEFAULT 1 CHECK (layer IN (1,2,3)),  -- 1 recurring, 2 seasonal, 3 one-off (0 = channel default, not a block)
  -- HOW IT BEHAVES
  start_mode      TEXT NOT NULL DEFAULT 'hard' CHECK (start_mode IN ('hard','flexible')),
  end_mode        TEXT NOT NULL DEFAULT 'hard' CHECK (end_mode IN ('hard','flexible')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal')),
  mode            TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','manual')),
  -- WHAT FILLS IT
  fill_kind       TEXT NOT NULL CHECK (fill_kind IN ('programme','autopilot','playlist','template','manual')),
  programme_id    TEXT REFERENCES programmes(id),
  list_id         TEXT REFERENCES sched_lists(id),   -- playlist or template
  tags_any_json   TEXT,                           -- autopilot tags (and the auto-fill pool for every kind)
  when_short      TEXT NOT NULL DEFAULT 'fill' CHECK (when_short IN ('fill','loop')),
  public          INTEGER NOT NULL DEFAULT 1,     -- shown on /schedule (0 = folded into the channel default there)
  active          INTEGER NOT NULL DEFAULT 1,
  created_at_ms   INTEGER NOT NULL,
  updated_at_ms   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_blocks_channel ON sched_blocks(channel_id, active);

-- Release 1 blocks become exactly what they were: weekly, layer 1, hard start, hard end, auto.
INSERT OR IGNORE INTO sched_blocks (id, channel_id, name, description, colour, recurrence, days_mask, start_min, end_min,
  layer, start_mode, end_mode, priority, mode, fill_kind, programme_id, tags_any_json, active, created_at_ms, updated_at_ms)
SELECT id, channel_id, name, description, colour, 'weekly', days_mask, start_min, end_min,
  1, 'hard', 'hard', 'normal', 'auto', fill_kind, programme_id, tags_any_json, active, created_at_ms, updated_at_ms
FROM sched_grid_blocks;

-- "Every Friday except 25 December": one row per skipped occurrence.
CREATE TABLE IF NOT EXISTS sched_block_exceptions (
  block_id   TEXT NOT NULL REFERENCES sched_blocks(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,           -- the Paris date the skipped occurrence would START on
  reason     TEXT,
  PRIMARY KEY (block_id, date)
);

-- One block occurrence's own running order: a manual block's content for
-- that date, or a template block's episode ("Create next episode").
CREATE TABLE IF NOT EXISTS sched_running_orders (
  id             TEXT PRIMARY KEY,                -- newId('ro')
  block_id       TEXT NOT NULL REFERENCES sched_blocks(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,                   -- the occurrence's Paris start date
  from_list_id   TEXT REFERENCES sched_lists(id),
  note           TEXT NOT NULL DEFAULT '',
  updated_at_ms  INTEGER NOT NULL,
  UNIQUE (block_id, date)
);

CREATE TABLE IF NOT EXISTS sched_running_order_items (
  running_order_id TEXT NOT NULL REFERENCES sched_running_orders(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  slot_kind        TEXT NOT NULL CHECK (slot_kind IN ('fixed','rule','episode')),
  track_id         TEXT REFERENCES tracks(id),
  audio_asset_id   TEXT REFERENCES audio_assets(id),
  rule_json        TEXT,
  label            TEXT,
  at_ms            INTEGER,
  auto_filled      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (running_order_id, position)
);

-- Published plans: immutable snapshots, one numbered series per channel.
CREATE TABLE IF NOT EXISTS sched_plans (
  id                TEXT PRIMARY KEY,             -- newId('pln')
  channel_id        TEXT NOT NULL REFERENCES channels(id),
  number            INTEGER NOT NULL,             -- shown as "Plan 12"
  plan_json         TEXT NOT NULL,
  summary           TEXT NOT NULL,
  actor             TEXT NOT NULL CHECK (actor IN ('studio','system')),
  based_on_number   INTEGER,
  rollback_of       INTEGER,
  version_id        TEXT,                         -- the log version published with it (NULL if it only changes days beyond the horizon)
  effective_from_ms INTEGER NOT NULL,
  created_at_ms     INTEGER NOT NULL,
  UNIQUE (channel_id, number)
);
CREATE INDEX IF NOT EXISTS idx_sched_plans_latest ON sched_plans(channel_id, number);

-- Release 1's CHECK constraints stay; these carry the finer detail.
ALTER TABLE sched_versions ADD COLUMN action TEXT;
ALTER TABLE sched_log_items ADD COLUMN fixed INTEGER NOT NULL DEFAULT 0;
UPDATE sched_versions SET action = 'remove' WHERE kind = 'skip' AND summary LIKE 'Removed%';
