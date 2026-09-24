import type { Env } from "./types";

/**
 * Top 3 Creator Songs of 2026: the fixed dates and limits, and which phase
 * the competition is in right now. Every date in the rules is Paris time;
 * they're written here in UTC. All four fall in summer time (CEST, UTC+2) -
 * summer time starts on 28 March 2027, before entries close.
 */
export const CONTEST = {
  entriesOpen: "2026-09-30T22:00:00Z", // 1 Oct 2026 00:00 Paris
  entriesClose: "2027-03-31T21:59:59Z", // 31 Mar 2027 23:59:59 Paris
  votingOpen: "2027-03-31T22:00:00Z", // 1 Apr 2027 00:00 Paris
  votingClose: "2027-07-31T21:59:59Z", // 31 Jul 2027 23:59:59 Paris
  eligibleFrom: "2026-01-01",
  eligibleTo: "2026-12-31",
  // One song per creator (rules section 4). A rejected or withdrawn entry frees the slot.
  maxEntriesPerEntrant: 1,
  maxAudioBytes: 20 * 1024 * 1024,
  maxPhotoBytes: 5 * 1024 * 1024,
  maxDurationSeconds: 8 * 60,
} as const;

export type ContestPhase = "before_entries" | "entries_open" | "voting" | "results_pending" | "complete";

/** Set to any value by the Studio after the Countdown show announces the winners. */
export const ANNOUNCED_KEY = "contest:announced";

// "complete" is not date-driven: the Studio flips KV key contest:announced
// after the Countdown show. Until then, after votingClose, it's results_pending.
// The gap between entriesClose and votingOpen is one second, so it counts as voting.
export async function contestPhase(env: Env, now = new Date()): Promise<ContestPhase> {
  const t = now.getTime();
  if (t < Date.parse(CONTEST.entriesOpen)) return "before_entries";
  if (t <= Date.parse(CONTEST.entriesClose)) return "entries_open";
  if (t <= Date.parse(CONTEST.votingClose)) return "voting";
  return (await env.CONFIG.get(ANNOUNCED_KEY)) ? "complete" : "results_pending";
}

/**
 * Likes on contest songs are hidden while voting runs and until the winners
 * are announced, so a heart can't be mistaken for a vote. The app mirrors
 * this from /api/contest/state; the likes API enforces it.
 */
export function canLikeContestSongs(phase: ContestPhase): boolean {
  return phase === "before_entries" || phase === "entries_open" || phase === "complete";
}

/** Today's date in Paris, YYYY-MM-DD. */
export function parisDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * A positive integer that changes once a day (Paris time), for the browse
 * page's daily shuffle: the order is fair to unknown creators, but stable
 * all day so "Load more" never repeats or skips a song.
 */
export function dailySeed(now = new Date()): number {
  return (Number(parisDate(now).replace(/-/g, "")) % 1000003) + 7;
}

export const SHUFFLE_MODULUS = 2147483647;

/**
 * The multiplier for ORDER BY (id * m) % 2147483647. It has to be large:
 * with the raw seed (~260,000) the product stays below the modulus for every
 * song number under ~8,000, so the "shuffle" would just be song-number
 * order. Scrambling the seed first gives a big, different multiplier each
 * day. Always 1..2147483646, and id * m stays well inside SQLite's 64-bit
 * integers for any realistic song number.
 */
export function shuffleMultiplier(now = new Date()): number {
  return ((dailySeed(now) * 48271) % (SHUFFLE_MODULUS - 1)) + 1;
}
