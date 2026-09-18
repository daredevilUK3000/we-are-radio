-- Phase 3 prep (handoff_radio_brain_roadmap.md): time-of-day sweepers need
-- to be findable by time band ("morning", "afternoon", "evening", "night"),
-- the same way tracks are findable by mood. Reuses the existing tags table
-- rather than a separate vocabulary - exactly what migrations/0001_init.sql
-- anticipated ("the same tags/track_tags pattern can later be reused for
-- programmes or audio assets without duplicating the taxonomy").
CREATE TABLE IF NOT EXISTS audio_asset_tags (
  audio_asset_id TEXT NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
  tag_id         TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (audio_asset_id, tag_id)
);
