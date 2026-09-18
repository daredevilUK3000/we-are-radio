-- Phase 3 prep (handoff_radio_brain_roadmap.md): the time-of-day feature
-- itself is deliberately not built yet - the roadmap gates it on catalogue
-- growth, and today only 2 channels are live with no tagged content behind
-- the other four. This just gives those four channels a catalogue_rules
-- match against the existing mood vocabulary (app/src/shared/moods.ts) so
-- tagging tracks into them now immediately counts, ahead of Phase 3.
--
-- We Are Archive is deliberately left with no catalogue_rules - its brief
-- ("older recordings, stories, interviews, career material") is about
-- spoken/archival content and audio_assets, not a mood tag from the
-- existing vocabulary. It needs either a new tag or its own curation
-- approach, not a forced fit here.
UPDATE channels SET catalogue_rules = '{"tags_any": ["romantic"]}' WHERE slug = 'we-are-love';
UPDATE channels SET catalogue_rules = '{"tags_any": ["relaxing", "night", "slow"]}' WHERE slug = 'we-are-after-dark';
UPDATE channels SET catalogue_rules = '{"tags_any": ["instrumental", "orchestral"]}' WHERE slug = 'we-are-instrumental';

-- These three are automatic, tag-curated channels by design (brief Section
-- 33) - autopilot now so the moment each has tagged tracks and goes live,
-- it just plays, with no separate mode toggle to remember. We Are Archive
-- stays 'manual' (the default): with no catalogue_rules, autopilot would
-- fall back to the whole undifferentiated catalogue, which is wrong for a
-- channel specifically about older/archival material.
UPDATE channels SET programming_mode = 'autopilot' WHERE slug IN ('we-are-love', 'we-are-after-dark', 'we-are-instrumental');
