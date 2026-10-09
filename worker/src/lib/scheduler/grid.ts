import { addDaysTo, hhmm, parisDate, parisWallClockToUtcMs, weekdayIndex, WEEKDAY_SHORT, DAY } from "./time";

/** A row of sched_grid_blocks. */
export interface GridBlock {
  id: string;
  channel_id: string;
  name: string;
  description: string;
  days_mask: number;
  start_min: number;
  end_min: number;
  fill_kind: "programme" | "autopilot";
  programme_id: string | null;
  tags_any_json: string | null;
  colour: "blue" | "purple" | "gold" | "green";
  active: number;
  created_at_ms: number;
  updated_at_ms: number;
}

/** One dated airing of a block: e.g. "Afternoon Mix" on Wednesday 1 October, 16:00-18:00 Paris. */
export interface Occurrence {
  block: GridBlock;
  /** The Paris date the block starts on. */
  date: string;
  startMs: number;
  endMs: number;
  /** Set on a channel's time-of-day day-part (dayparts.ts), which isn't a real block. */
  daypart?: import("./dayparts").TimeBand;
}

export async function loadGridBlocks(db: D1Database, channelId: string, includeInactive = false): Promise<GridBlock[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM sched_grid_blocks WHERE channel_id = ? ${includeInactive ? "" : "AND active = 1"} ORDER BY start_min, name`
    )
    .bind(channelId)
    .all<GridBlock>();
  return results;
}

export const runsPastMidnight = (b: Pick<GridBlock, "start_min" | "end_min">) => b.end_min <= b.start_min;
export const blockLengthMin = (b: Pick<GridBlock, "start_min" | "end_min">) =>
  runsPastMidnight(b) ? 1440 - b.start_min + b.end_min : b.end_min - b.start_min;

/** The occurrence of a block starting on a Paris date, or null when the block doesn't run that day (or falls in the spring clock-change gap). */
export function occurrenceOn(block: GridBlock, date: string): Occurrence | null {
  if (!(block.days_mask & (1 << weekdayIndex(date)))) return null;
  const startMs = parisWallClockToUtcMs(date, block.start_min);
  const endMs = runsPastMidnight(block)
    ? parisWallClockToUtcMs(addDaysTo(date, 1), block.end_min)
    : parisWallClockToUtcMs(date, block.end_min);
  if (endMs <= startMs) return null; // wholly inside the missing spring hour
  return { block, date, startMs, endMs };
}

/**
 * Every occurrence overlapping [fromMs, toMs), in time order. If two ever
 * overlapped (validation prevents it), the later one starts when the earlier ends.
 */
export function occurrencesBetween(blocks: GridBlock[], fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  let date = addDaysTo(parisDate(fromMs), -1);
  const last = parisDate(toMs + DAY);
  for (let guard = 0; date <= last && guard < 60; guard++, date = addDaysTo(date, 1)) {
    for (const b of blocks) {
      if (!b.active) continue;
      const occ = occurrenceOn(b, date);
      if (occ && occ.endMs > fromMs && occ.startMs < toMs) out.push(occ);
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < out.length; i++) {
    if (out[i].startMs < out[i - 1].endMs) out[i] = { ...out[i], startMs: out[i - 1].endMs };
  }
  return out.filter((o) => o.endMs > o.startMs);
}

/** "Wed 16:00–18:00" */
export const occurrenceLabel = (o: Occurrence) =>
  `${WEEKDAY_SHORT[weekdayIndex(o.date)]} ${hhmm(o.block.start_min)}–${hhmm(o.block.end_min)}`;

export const blockReason = (o: Occurrence) => `From the ${o.block.name} block (${occurrenceLabel(o)})`;

export function blockTags(block: GridBlock): string[] {
  try {
    const v = block.tags_any_json ? JSON.parse(block.tags_any_json) : [];
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
