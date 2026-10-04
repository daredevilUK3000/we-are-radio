-- "From the makers of We Are Radio" (handoff_from_the_makers.md, 4 Oct 2026):
-- clicks through to the maker's other products. Which product and where on the
-- page (the landing-page card or the footer) - nothing about the listener,
-- like 0014. Its own table, as tv_events in 0021 (site_events has a CHECK on
-- event_type).
--
-- Takes 0024, which the Scheduler Release 2 plan had pencilled in; that moves to 0025.

CREATE TABLE IF NOT EXISTS outbound_clicks (
  id          INTEGER PRIMARY KEY,
  target      TEXT NOT NULL,     -- human-radio | personality-blueprint | purpose-dna
  placement   TEXT NOT NULL,     -- card | footer
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_clicks_timestamp ON outbound_clicks(timestamp);
