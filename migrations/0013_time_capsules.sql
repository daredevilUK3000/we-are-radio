-- Time Capsules: a listener asks for a short message (a birthday shout-out, a
-- get-well, an anniversary) to go out on air on a date that matters to them.
-- It is REQUEST-BASED, never open upload: nothing airs until Kizzi has recorded
-- (or approved) the actual audio in the Studio, so no unreviewed public audio
-- can ever be broadcast. The finished recording is an ordinary audio asset,
-- scheduled with a date check instead of the recurring jingle cadence.
--
-- status flow:  requested -> recorded -> scheduled -> aired   (or cancelled)
--
-- scheduled_date is a plain date in the station's own time (Europe/London): a
-- capsule airs "on its date", not at a promised minute.
CREATE TABLE IF NOT EXISTS time_capsules (
  id              TEXT PRIMARY KEY,
  audio_asset_id  TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,
  requester_name  TEXT NOT NULL,
  recipient_name  TEXT NOT NULL DEFAULT '',
  occasion_label  TEXT NOT NULL,
  message_note    TEXT NOT NULL DEFAULT '',
  notify_email    TEXT,
  scheduled_date  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested', 'recorded', 'scheduled', 'aired', 'cancelled')),
  aired_at        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_time_capsules_date ON time_capsules(scheduled_date, status);
CREATE INDEX IF NOT EXISTS idx_time_capsules_asset ON time_capsules(audio_asset_id);
