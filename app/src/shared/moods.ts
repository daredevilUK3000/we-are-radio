// Straight from Section 5 of the brief - the flexible, growable mood/vibe
// vocabulary. Shared between the Studio's tagging UI (ChipPicker) and the
// listener-facing session builder, so both work against the same taxonomy.
export const MOOD_OPTIONS = [
  "romantic",
  "upbeat",
  "relaxing",
  "dance",
  "rock",
  "pop",
  "instrumental",
  "orchestral",
  "1950s-inspired",
  "1960s-inspired",
  "Christmas",
  "summer",
  "morning",
  "afternoon",
  "evening",
  "night",
  "slow",
  "fast",
];

// The four bands Phase 3's time-of-day flow tunes between (handoff_radio_
// brain_roadmap.md) - a subset of MOOD_OPTIONS above, used to tag jingles/
// station IDs so the right sweeper plays for the right transition.
export const TIME_OF_DAY_BANDS = ["morning", "afternoon", "evening", "night"] as const;
export type TimeOfDayBand = (typeof TIME_OF_DAY_BANDS)[number];
