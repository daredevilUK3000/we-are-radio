import type { Channel } from "../types";
import type { GridBlock, Occurrence } from "./grid";
import { addDaysTo, parisDate, parisWallClockToUtcMs, DAY } from "./time";

/**
 * Times of day for SONGS (Kizzi, 7 Oct 2026): a song tagged with a time of
 * day - morning, afternoon, evening or night - only plays then, on every
 * channel; a song with none of those tags plays any time. It's the rule the
 * jingles already follow.
 *
 * On an autopilot channel, the time no block covers is split into these four
 * day-parts (Paris time). Each one is laid out like an autopilot block - its
 * own shuffled order of the songs allowed then, seeded per day, starting on
 * the dot and fitted to end on the dot - so the planner's block machinery
 * (resume, no repeats within two hours, fitting) does all the work. Day-part
 * items carry no block id: to everything else (health, now-playing, the
 * Studio) they're ordinary channel music, as before.
 */

export type TimeBand = "morning" | "afternoon" | "evening" | "night";
export const TIME_BANDS: TimeBand[] = ["morning", "afternoon", "evening", "night"];

/** Start and end in minutes after Paris midnight; night ends at 05:00 the next day. */
const BAND_MINUTES: Record<TimeBand, { start: number; end: number }> = {
  morning: { start: 5 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 22 * 60 },
  night: { start: 22 * 60, end: 5 * 60 },
};

const LABELS: Record<TimeBand, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

/**
 * The safety minimum (Kizzi, 9 Oct 2026): a themed channel can have very few
 * songs for some times of day (the 50s channel had 3 for the morning). Below
 * this many, the day-part tops up with the channel's other songs, nearest
 * time of day first, so it never loops a handful of songs for hours.
 */
export const MIN_DAYPART_SONGS = 25;

/** How far a song's nearest time of day is from `band` (0 = allowed, 1 = the next one along, 2 = opposite). */
export function bandDistance(bandsOfSong: Set<TimeBand> | undefined, band: TimeBand): number {
  if (allowedIn(bandsOfSong, band)) return 0;
  const i = TIME_BANDS.indexOf(band);
  let best = 2;
  for (const b of bandsOfSong!) {
    const d = Math.abs(TIME_BANDS.indexOf(b) - i);
    best = Math.min(best, Math.min(d, TIME_BANDS.length - d));
  }
  return best;
}

/** Whether a song with these time-of-day tags may play in `band`. */
export function allowedIn(bandsOfSong: Set<TimeBand> | undefined, band: TimeBand): boolean {
  return !bandsOfSong || bandsOfSong.size === 0 || bandsOfSong.has(band);
}

export const daypartsApply = (channel: Channel) => channel.programming_mode === "autopilot";

function daypartBlock(channel: Channel, band: TimeBand): GridBlock {
  const m = BAND_MINUTES[band];
  return {
    id: `daypart:${band}`,
    channel_id: channel.id,
    name: `${LABELS[band].toLowerCase()} music`,
    description: channel.description ?? "",
    days_mask: 127,
    start_min: m.start,
    end_min: m.end,
    fill_kind: "autopilot",
    programme_id: null,
    tags_any_json: null,
    colour: "blue",
    active: 1,
    created_at_ms: 0,
    updated_at_ms: 0,
  };
}

/** The day-parts overlapping [fromMs, toMs), in time order. */
export function daypartsBetween(channel: Channel, fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  let date = addDaysTo(parisDate(fromMs), -1);
  const last = parisDate(toMs + DAY);
  for (let guard = 0; date <= last && guard < 60; guard++, date = addDaysTo(date, 1)) {
    for (const band of TIME_BANDS) {
      const m = BAND_MINUTES[band];
      const startMs = parisWallClockToUtcMs(date, m.start);
      const endMs = m.end <= m.start ? parisWallClockToUtcMs(addDaysTo(date, 1), m.end) : parisWallClockToUtcMs(date, m.end);
      if (endMs > startMs && endMs > fromMs && startMs < toMs) out.push({ block: daypartBlock(channel, band), date, startMs, endMs, daypart: band });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Full length of a day-part in seconds (for spreading the day's time capsules through what actually plays). */
export const daypartSeconds = (o: Occurrence) => Math.round((o.endMs - o.startMs) / 1000);

export const daypartReason = (o: Occurrence) =>
  `Autopilot, ${LABELS[o.daypart as TimeBand].toLowerCase()} (${String(Math.floor(BAND_MINUTES[o.daypart as TimeBand].start / 60)).padStart(2, "0")}:00 to ${String(Math.floor(BAND_MINUTES[o.daypart as TimeBand].end / 60)).padStart(2, "0")}:00): songs for any time, or tagged ${o.daypart}`;

/** Every published song's time-of-day tags, by track id (songs with none are absent). */
export async function songBands(db: D1Database): Promise<Map<string, Set<TimeBand>>> {
  const { results } = await db
    .prepare(
      `SELECT tt.track_id, tg.name FROM track_tags tt JOIN tags tg ON tg.id = tt.tag_id
       WHERE tg.name IN ('morning', 'afternoon', 'evening', 'night')`
    )
    .all<{ track_id: string; name: TimeBand }>();
  const m = new Map<string, Set<TimeBand>>();
  for (const r of results) {
    if (!m.has(r.track_id)) m.set(r.track_id, new Set());
    m.get(r.track_id)!.add(r.name);
  }
  return m;
}
