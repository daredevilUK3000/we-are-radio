-- Scheduler, Release 1. See handoff_scheduler_release1.md.
-- A channel's broadcast is a sequence of immutable, versioned log segments.
-- Each published version covers [effective_from_ms, horizon_ms). For any
-- moment t, the governing version is the highest-numbered published version
-- with effective_from_ms <= t. New versions never edit old rows: build fully,
-- validate, then publish with one compare-and-swap. A failed build is
-- simply never published.
--
-- Times in these tables are Unix milliseconds (INTEGER), not ISO text like
-- the rest of the schema: the log is arithmetic-heavy (item ends, drift,
-- fits) and range-queried every few seconds by /api/now-playing, and integer
-- ranges index and compare cheaply. Europe/Paris wall-clock logic (the
-- weekly grid) happens in code, never in SQL.

CREATE TABLE IF NOT EXISTS sched_channels (
  channel_id            TEXT PRIMARY KEY REFERENCES channels(id),
  enabled               INTEGER NOT NULL DEFAULT 0,  -- 0 = shadow (log generated, old path still plays); 1 = players follow the log
  enabled_at            TEXT,
  last_run_at_ms        INTEGER,
  last_run_ok           INTEGER,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  inputs_fingerprint    TEXT,                        -- what the last generation was built from
  on_fallback_since_ms  INTEGER,                     -- set while now-playing serves the emergency fallback
  shadow_mismatches     INTEGER NOT NULL DEFAULT 0,  -- shadow-mode comparison failures, last 24 h
  shadow_checks         INTEGER NOT NULL DEFAULT 0,
  shadow_window_start_ms INTEGER,                    -- when the current 24 h shadow window began
  shadow_last_mismatch_ms INTEGER,                   -- the last shadow mismatch (going on air needs 24 h without one)
  shadow_since_ms       INTEGER                      -- the first shadow check
);

CREATE TABLE IF NOT EXISTS sched_versions (
  id                     TEXT PRIMARY KEY,           -- newId('ver')
  channel_id             TEXT NOT NULL REFERENCES channels(id),
  number                 INTEGER NOT NULL,           -- 1, 2, 3... per channel once published; shown as "v42"
  status                 TEXT NOT NULL DEFAULT 'building'
                           CHECK (status IN ('building','published','failed')),
  effective_from_ms      INTEGER NOT NULL,
  horizon_ms             INTEGER NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('generate','extend','play_now','skip','insert_next','replace',
                                                       'insert_jingle','record_link','back_on_schedule','rollback','grid')),
  actor                  TEXT NOT NULL CHECK (actor IN ('studio','generator','system')),
  based_on_version_id    TEXT,                       -- the version live when this one was built
  rollback_of_version_id TEXT,                       -- for kind='rollback'
  summary                TEXT NOT NULL,              -- "Play now: Leave a candle burning", "Extended to Tue 07:00"
  item_count             INTEGER,
  error                  TEXT,                       -- why a build failed validation
  created_at_ms          INTEGER NOT NULL,
  published_at_ms        INTEGER,
  anchor_ms              INTEGER                     -- live controls: the time the recovery keeps (e.g. 19:00)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sched_versions_number ON sched_versions(channel_id, number) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_sched_versions_lookup ON sched_versions(channel_id, status, effective_from_ms, number);

CREATE TABLE IF NOT EXISTS sched_log_items (
  id              INTEGER PRIMARY KEY,
  version_id      TEXT NOT NULL REFERENCES sched_versions(id),
  airing_id       TEXT NOT NULL,          -- STABLE across versions for the same airing; newId('air')
  starts_at_ms    INTEGER NOT NULL,
  ends_at_ms      INTEGER NOT NULL,       -- scheduled on-air end; may be earlier than the file's natural end (a fade)
  offset_ms       INTEGER NOT NULL DEFAULT 0,  -- how far into the file this airing begins (a loop that changed mid-song, as before the Scheduler)
  item_type       TEXT NOT NULL,          -- song | station_id | jingle | promo | link | feature | interview | capsule
  track_id        TEXT,
  audio_asset_id  TEXT,
  label           TEXT,
  audio_url       TEXT NOT NULL,
  artwork_url     TEXT,
  file_duration_ms INTEGER NOT NULL,
  overlays_json   TEXT,                   -- ducked jingles, exactly as RotationItem.overlays
  block_id        TEXT,                   -- the grid block this item was generated for; NULL = channel default
  block_date      TEXT,                   -- Paris date of that block occurrence, YYYY-MM-DD
  source          TEXT NOT NULL CHECK (source IN ('programme','autopilot','capsule','override','fallback')),
  source_ref      TEXT,                   -- programme id / 'rotation:<hash>' / capsule id / override version id
  reason_json     TEXT                    -- source-based reasons ("why is this playing?")
);
CREATE INDEX IF NOT EXISTS idx_sched_items_version_time ON sched_log_items(version_id, starts_at_ms);

CREATE TABLE IF NOT EXISTS sched_aired (
  id              INTEGER PRIMARY KEY,
  channel_id      TEXT NOT NULL,
  airing_id       TEXT NOT NULL,
  version_id      TEXT NOT NULL,          -- the version that governed it when it started
  starts_at_ms    INTEGER NOT NULL,
  scheduled_end_ms INTEGER NOT NULL,
  actual_end_ms   INTEGER,                -- set when it ended (early if skipped or interrupted)
  ended_how       TEXT CHECK (ended_how IN ('completed','skipped','interrupted')),
  item_type       TEXT NOT NULL,
  track_id        TEXT,
  audio_asset_id  TEXT,
  label           TEXT,
  source          TEXT NOT NULL,
  UNIQUE (channel_id, airing_id)
);
CREATE INDEX IF NOT EXISTS idx_sched_aired_channel_time ON sched_aired(channel_id, starts_at_ms);
CREATE INDEX IF NOT EXISTS idx_sched_aired_track ON sched_aired(track_id, starts_at_ms);

CREATE TABLE IF NOT EXISTS sched_changes (
  id              INTEGER PRIMARY KEY,
  channel_id      TEXT NOT NULL,
  version_id      TEXT,
  at_ms           INTEGER NOT NULL,
  actor           TEXT NOT NULL,          -- 'studio' | 'generator' | 'system'
  action          TEXT NOT NULL,          -- same vocabulary as sched_versions.kind, plus 'enable','disable','fallback_set'
  airing_id       TEXT,                   -- the item affected, when there is one
  before_json     TEXT,                   -- e.g. {"label":"Song A","track_id":"..."}
  after_json      TEXT,
  reason          TEXT                    -- human sentence: "Replaced by Patrick", "Dropped to keep 19:00 on time"
);
CREATE INDEX IF NOT EXISTS idx_sched_changes_channel_time ON sched_changes(channel_id, at_ms);
CREATE INDEX IF NOT EXISTS idx_sched_changes_airing ON sched_changes(airing_id);

CREATE TABLE IF NOT EXISTS sched_fallback_items (
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  position        INTEGER NOT NULL,
  track_id        TEXT,
  audio_asset_id  TEXT,
  PRIMARY KEY (channel_id, position)
);

-- The weekly programme grid. Times are Europe/Paris wall-clock minutes from
-- midnight, converted to instants per date in code. A block whose end is
-- earlier than its start runs past midnight into the next day, and belongs
-- to the day it starts. Time not covered by any block = the channel default
-- (the pre-Scheduler behaviour).
CREATE TABLE IF NOT EXISTS sched_grid_blocks (
  id              TEXT PRIMARY KEY,         -- newId('blk')
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  name            TEXT NOT NULL,            -- "Afternoon Mix"
  description     TEXT NOT NULL,            -- the sound, one line: "Upbeat soul and gospel"
  days_mask       INTEGER NOT NULL,         -- bit 0 = Monday ... bit 6 = Sunday
  start_min       INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min         INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  fill_kind       TEXT NOT NULL CHECK (fill_kind IN ('programme','autopilot')),
  programme_id    TEXT REFERENCES programmes(id),   -- fill_kind = 'programme'
  tags_any_json   TEXT,                     -- fill_kind = 'autopilot': tags, as channels.catalogue_rules
  colour          TEXT NOT NULL DEFAULT 'blue' CHECK (colour IN ('blue','purple','gold','green')),
  active          INTEGER NOT NULL DEFAULT 1,
  created_at_ms   INTEGER NOT NULL,
  updated_at_ms   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_grid_channel ON sched_grid_blocks(channel_id, active);

CREATE TABLE IF NOT EXISTS sched_runs (
  id              INTEGER PRIMARY KEY,
  channel_id      TEXT NOT NULL,
  kind            TEXT NOT NULL,          -- generate | extend | action
  started_at_ms   INTEGER NOT NULL,
  finished_at_ms  INTEGER,
  ok              INTEGER,
  error           TEXT,
  version_id      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sched_runs_channel ON sched_runs(channel_id, started_at_ms);

-- Every channel starts in shadow.
INSERT OR IGNORE INTO sched_channels (channel_id, enabled) SELECT id, 0 FROM channels;
