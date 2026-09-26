import type { ContestPhase, ContestState } from "../../../api/client";

/**
 * Every word, link and countdown the homepage's Top 3 pieces show (the
 * announcement bar, the nav and hero pills, the feature band), per contest
 * phase - one table so they can never disagree. Handoff: Top 3 on the
 * homepage, section 2.
 */

export interface PhaseCopy {
  phase: ContestPhase;
  bar: { text: string; button: string; to: string; phoneLink: string };
  pillSuffix: string;
  bandTag: string;
  eyebrow: string;
  lede: string;
  countdown: { label: string; target: string } | null;
  primary: { label: string; to: string };
  secondary: { label: string; to: string };
  bottom: "stages" | "running" | "podium" | null;
  /** The four-stage strip's date lines (before_entries only). */
  stages: [string, string, string, string];
}

const TITLE = "Top 3 Creator Songs of 2026";

// TODO(Phase B): replace with round data from /api/contest/state
// The ends of the four voting rounds, 23:59:59 Paris time (CEST, UTC+2).
const ROUND_ENDS = ["2027-04-30T21:59:59Z", "2027-05-31T21:59:59Z", "2027-06-30T21:59:59Z", "2027-07-31T21:59:59Z"];

/** The end of the current voting round: the first round end still in the future (null after the last). */
export function roundEnd(now = new Date()): string | null {
  return ROUND_ENDS.find((iso) => Date.parse(iso) > now.getTime()) ?? null;
}

const paris = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString("en-GB", { ...opts, timeZone: "Europe/Paris" });

export function copyFor(state: ContestState, now = new Date()): PhaseCopy {
  const { dates } = state;
  // "1 October", "1 OCT", "1 OCTOBER 2026" - all from the real dates, never typed in.
  const openDay = paris(dates.entriesOpen, { day: "numeric", month: "long" });
  const openShort = paris(dates.entriesOpen, { day: "numeric", month: "short" }); // "1 Oct"
  const openFull = paris(dates.entriesOpen, { day: "numeric", month: "long", year: "numeric" }).toUpperCase();
  const stages: PhaseCopy["stages"] = [
    `01 · FROM ${openDay.toUpperCase()}`,
    `02 · FROM ${paris(dates.entriesOpen, { month: "long" }).toUpperCase()}`,
    `03 · ${paris(dates.votingOpen, { month: "long" })} – ${paris(dates.votingClose, { month: "long", year: "numeric" })}`.toUpperCase(),
    "04 · SEPTEMBER 2027",
  ];

  // A Studio preview is still before_entries: the homepage never pretends entries are open to the public.
  switch (state.phase) {
    case "before_entries":
      return {
        phase: "before_entries",
        bar: { text: `${TITLE}: entries open ${openDay}`, button: "Find out more", to: "/top3", phoneLink: `opens ${openShort}` },
        pillSuffix: `OPENS ${openShort.toUpperCase()}`,
        bandTag: "COMING SOON",
        eyebrow: `ENTRIES OPEN ${openFull}`,
        lede: "Our international search for the three best songs made by Independent Creators this year. Free to enter, from any country.",
        countdown: { label: "ENTRIES OPEN IN", target: dates.entriesOpen },
        primary: { label: "HOW IT WORKS", to: "/top3" },
        secondary: { label: "READ THE RULES", to: "/top3/rules" },
        bottom: "stages",
        stages,
      };
    case "entries_open":
      return {
        phase: "entries_open",
        bar: { text: `Now accepting entries: ${TITLE}`, button: "Enter your song", to: "/top3/enter", phoneLink: "enter now" },
        pillSuffix: "ENTRIES OPEN",
        bandTag: "NOW ACCEPTING ENTRIES",
        eyebrow: "NOW ACCEPTING ENTRIES · WORLDWIDE",
        lede: "Made a song this year? Enter it for free. Approved songs get their own page, a shot at airplay, and a place in the public vote.",
        countdown: { label: "ENTRIES CLOSE IN", target: dates.entriesClose },
        primary: { label: "ENTER YOUR SONG", to: "/top3/enter" },
        secondary: { label: "BROWSE THE SONGS", to: "/top3" },
        bottom: "running",
        stages,
      };
    case "voting": {
      const end = roundEnd(now);
      return {
        phase: "voting",
        bar: { text: `Voting is open: help choose the ${TITLE}`, button: "Vote now", to: "/top3", phoneLink: "vote now" },
        pillSuffix: "VOTING OPEN",
        bandTag: "VOTING NOW",
        eyebrow: "THE WORLD IS VOTING",
        lede: "Listen to the songs still in the running and vote for your favourites. Three votes a day, every day.",
        countdown: end ? { label: "THIS ROUND CLOSES IN", target: end } : null,
        primary: { label: "VOTE NOW", to: "/top3" },
        secondary: { label: "HOW VOTING WORKS", to: "/top3/rules" },
        bottom: "running",
        stages,
      };
    }
    case "results_pending":
      return {
        phase: "results_pending",
        bar: { text: "The votes are in: the Top 3 will be revealed live on air", button: "Find out more", to: "/top3", phoneLink: "results soon" },
        pillSuffix: "RESULTS SOON",
        bandTag: "RESULTS SOON",
        eyebrow: "THE VOTES ARE IN",
        lede: "Four rounds of voting are over. The Top 3 will be revealed on a live countdown show on We Are Radio.",
        countdown: null,
        primary: { label: "HEAR THE SONGS", to: "/top3" },
        secondary: { label: "HOW WINNERS ARE CHOSEN", to: "/top3/rules" },
        bottom: null,
        stages,
      };
    case "complete":
    default:
      return {
        phase: "complete",
        bar: { text: `The ${TITLE} have been crowned`, button: "Meet the winners", to: "/top3", phoneLink: "the winners" },
        pillSuffix: "WINNERS ANNOUNCED",
        bandTag: "CROWNED LIVE ON AIR",
        eyebrow: "CROWNED LIVE ON WE ARE RADIO",
        lede: "After months of entries and four rounds of voting, these are the three songs the world chose.",
        countdown: null,
        primary: { label: "MEET THE WINNERS", to: "/top3" },
        secondary: { label: "READ THE RULES", to: "/top3/rules" },
        bottom: "podium",
        stages,
      };
  }
}
