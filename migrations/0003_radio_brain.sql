-- Radio Brain (handoff_radio_brain_roadmap.md, Phase 1): channels now declare
-- how they're programmed. 'manual' is today's behaviour unchanged (Kizzi
-- builds/approves a published programme by hand or via the AI Producer -
-- the two are the same at playback time, since AI Assisted still ends in a
-- published programme for Kizzi to approve). 'autopilot' hands the channel
-- to the rules engine in worker/src/lib/radioBrain.ts - no programme, no
-- manual step per play.
ALTER TABLE channels ADD COLUMN programming_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (programming_mode IN ('manual', 'autopilot'));

-- We Are 50s has never had a manually-built programme - it was only ever
-- playable via the naive tag-loop fallback (since superseded by the Brain).
UPDATE channels SET programming_mode = 'autopilot' WHERE slug = 'we-are-50s';
