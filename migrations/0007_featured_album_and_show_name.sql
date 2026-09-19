-- Landing page lower half (handoff_landing_page_lower_half.md).
--
-- Featured Album: which album the homepage showcases has to be editable
-- from the Studio without a code change. A flag on albums (rather than a
-- separate setting) keeps it queryable in the same place as everything
-- else about an album; the Studio's "feature" action clears any previous
-- one, so at most one row is ever 1.
ALTER TABLE albums ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;

-- Podcasts showcase: Kizzi has two distinct shows (Friday Game Changers,
-- Let's Talk With Kizzi), so an episode card has to say which show it's
-- from. Captured from the RSS feed's channel title at import time (and
-- editable there). programmes.episode_number already exists - the importer
-- now fills it from <itunes:episode> when the feed provides one.
ALTER TABLE programmes ADD COLUMN show_name TEXT;
