export const GENRE_OPTIONS = [
  "Pop",
  "Rock",
  "Gospel",
  "Pop Gospel",
  "R&B",
  "Soul",
  "Hip-Hop",
  "Jazz",
  "Blues",
  "Country",
  "Electronic",
  "Dance",
  "Classical",
  "Reggae",
  "Folk",
  "Instrumental",
];

// Straight from Section 5 of the brief - the flexible, growable mood/vibe vocabulary.
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
  "night",
  "morning",
  "slow",
  "fast",
];

export const BPM_PRESETS: { label: string; value: number }[] = [
  { label: "Slow (~70)", value: 70 },
  { label: "Chill (~90)", value: 90 },
  { label: "Medium (~110)", value: 110 },
  { label: "Upbeat (~128)", value: 128 },
  { label: "Fast (~140)", value: 140 },
  { label: "Very fast (~160)", value: 160 },
];
