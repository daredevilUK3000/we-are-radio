-- Podcast Importer (handoff: Podcast Importer (Spotify RSS)). Lets an
-- audio_asset reference audio hosted elsewhere (Spotify for Creators)
-- instead of duplicating it into R2. Both columns are purely additive -
-- existing rows default to storage='r2', which is exactly what they are.
ALTER TABLE audio_assets ADD COLUMN storage TEXT NOT NULL DEFAULT 'r2' CHECK (storage IN ('r2', 'external'));

-- The feed's <guid> for each imported episode, so re-sync can tell which
-- episodes are already imported without re-importing them. NULL for every
-- non-imported asset - the partial unique index only applies where a guid
-- actually exists.
ALTER TABLE audio_assets ADD COLUMN external_guid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_assets_external_guid
  ON audio_assets(external_guid) WHERE external_guid IS NOT NULL;
