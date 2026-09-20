// "What do you need right now?" - the few things a listener can ask the radio
// for, and how each one maps onto the tag vocabulary the catalogue already uses.
// Tapping one is a plain lookup (no AI): the tags pick the songs, the wildcard
// tags loosen the match for the occasional surprise, and the link tags choose
// which of Kizzi's recorded spoken links suit it.

export interface Need {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
  /** Songs tagged with any of these are the "obvious" picks. */
  tags_any: string[];
  /** Songs with these tags (but not the above) can appear as a wildcard. */
  wildcard_tags: string[];
  /** Extra tags a spoken link may carry to count as a match (its need key always does). */
  link_tags: string[];
}

export const NEEDS: Need[] = [
  {
    key: "energy",
    label: "I need energy",
    emoji: "⚡",
    blurb: "Lift me up and get me moving",
    tags_any: ["upbeat", "dance", "rock"],
    wildcard_tags: ["pop", "summer"],
    link_tags: ["energy", "morning"],
  },
  {
    key: "love",
    label: "I want to fall in love",
    emoji: "❤️",
    blurb: "Something warm and romantic",
    tags_any: ["romantic"],
    wildcard_tags: ["relaxing", "evening"],
    link_tags: ["love", "evening"],
  },
  {
    key: "switch-off",
    label: "I want to switch off",
    emoji: "🌙",
    blurb: "Slow down and let it all go",
    tags_any: ["relaxing", "slow", "night"],
    wildcard_tags: ["romantic", "instrumental", "orchestral"],
    link_tags: ["switch-off", "night"],
  },
  {
    key: "fun",
    label: "I want to have fun",
    emoji: "🎉",
    blurb: "Good times, good music",
    tags_any: ["pop", "dance", "summer", "upbeat"],
    wildcard_tags: ["rock", "1950s-inspired"],
    link_tags: ["fun", "afternoon"],
  },
];

export const NEED_KEYS = NEEDS.map((n) => n.key);

export function findNeed(key: unknown): Need | undefined {
  return NEEDS.find((n) => n.key === key);
}
