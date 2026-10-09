import { addDaysTo, hhmm, parisDate, parisWallClockToUtcMs, weekdayIndex, WEEKDAY_SHORT, DAY } from "./time";

/**
 * Blocks and their occurrences (Release 1's weekly grid, extended in
 * Release 2: handoff_scheduler_release2.md §1.2 and §2.1-2.2).
 *
 * A block is a row of sched_blocks (the working copy) or a block inside a
 * published plan (plans.ts). Everything that decides what AIRS - the
 * generator, live-control recovery, health, the public guide - reads the
 * latest published plan (loadGridBlocks); only the Studio's editing reads the
 * working copy (loadWorkingBlocks).
 */

export type BlockColour = "blue" | "purple" | "gold" | "green" | "red" | "grey";

export interface GridBlock {
  id: string;
  channel_id: string;
  name: string;
  description: string;
  colour: BlockColour;
  // WHEN
  recurrence?: "once" | "weekly" | "monthly";
  days_mask: number | null;
  once_date?: string | null;
  /** {"day":15} or {"nth":1,"weekday":5} (weekday 0 = Monday; nth -1 = last). */
  monthly_rule?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  start_min: number;
  end_min: number;
  /** 1 recurring, 2 seasonal, 3 one-off; a higher layer cuts a lower one. */
  layer?: number;
  // HOW IT BEHAVES
  start_mode?: "hard" | "flexible";
  end_mode?: "hard" | "flexible";
  priority?: "high" | "normal";
  mode?: "auto" | "manual";
  // WHAT FILLS IT
  fill_kind: "programme" | "autopilot" | "playlist" | "template" | "manual";
  programme_id: string | null;
  list_id?: string | null;
  tags_any_json: string | null;
  when_short?: "fill" | "loop";
  public?: number;
  active: number;
  created_at_ms: number;
  updated_at_ms: number;
  /** Paris dates this block skips ("every Friday except 25 December"). */
  exceptions?: string[];
}

/** One dated airing of a block: e.g. "Afternoon Mix" on Wednesday 1 October, 16:00-18:00 Paris. */
export interface Occurrence {
  block: GridBlock;
  /** The Paris date the block starts on. */
  date: string;
  /** Where this stretch of the block starts on air (after a higher layer's special, that's when it resumes). */
  startMs: number;
  endMs: number;
  /**
   * Where the block's content is laid out from: the occurrence's own start.
   * Equal to startMs except for the part of a block that resumes after a
   * higher layer cut into it, which carries on as it was laid out (§2.2).
   */
  originMs?: number;
  /** This stretch ends where a higher layer cuts in (always a hard boundary). */
  cut?: boolean;
  /** Set on a channel's time-of-day day-part (dayparts.ts), which isn't a real block. */
  daypart?: import("./dayparts").TimeBand;
}

const BLOCK_COLUMNS = "*";

/** The working copy (Studio editing only): sched_blocks, with each block's exceptions. */
export async function loadWorkingBlocks(db: D1Database, channelId: string, includeInactive = false): Promise<GridBlock[]> {
  const { results } = await db
    .prepare(`SELECT ${BLOCK_COLUMNS} FROM sched_blocks WHERE channel_id = ? ${includeInactive ? "" : "AND active = 1"} ORDER BY start_min, name`)
    .bind(channelId)
    .all<GridBlock>();
  if (results.length === 0) return results;
  const { results: ex } = await db
    .prepare(
      `SELECT e.block_id, e.date FROM sched_block_exceptions e JOIN sched_blocks b ON b.id = e.block_id WHERE b.channel_id = ? ORDER BY e.date`
    )
    .bind(channelId)
    .all<{ block_id: string; date: string }>();
  const byBlock = new Map<string, string[]>();
  for (const e of ex) byBlock.set(e.block_id, [...(byBlock.get(e.block_id) ?? []), e.date]);
  return results.map((b) => ({ ...b, exceptions: byBlock.get(b.id) ?? [] }));
}

/** What airs: the blocks of the channel's latest published plan (plans.ts). */
export async function loadGridBlocks(db: D1Database, channelId: string, includeInactive = false): Promise<GridBlock[]> {
  const { latestPlan } = await import("./plans");
  const plan = await latestPlan(db, channelId);
  const blocks = plan?.snapshot.blocks ?? [];
  return includeInactive ? blocks : blocks.filter((b) => b.active);
}

export const runsPastMidnight = (b: Pick<GridBlock, "start_min" | "end_min">) => b.end_min <= b.start_min;
export const blockLengthMin = (b: Pick<GridBlock, "start_min" | "end_min">) =>
  runsPastMidnight(b) ? 1440 - b.start_min + b.end_min : b.end_min - b.start_min;

const daysInMonth = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Whether a monthly rule falls on this Paris date (§2.1): the 15th (the last day when the month is shorter), or the 1st Saturday / last Friday. */
function monthlyOn(ruleJson: string | null | undefined, date: string): boolean {
  let rule: { day?: number; nth?: number; weekday?: number } | null = null;
  try {
    rule = ruleJson ? JSON.parse(ruleJson) : null;
  } catch {
    rule = null;
  }
  if (!rule) return false;
  const dom = Number(date.slice(8, 10));
  const len = daysInMonth(date);
  if (typeof rule.day === "number") return dom === Math.min(rule.day, len);
  if (typeof rule.nth === "number" && typeof rule.weekday === "number") {
    if (weekdayIndex(date) !== rule.weekday) return false;
    if (rule.nth === -1) return dom + 7 > len;
    return Math.ceil(dom / 7) === rule.nth;
  }
  return false;
}

/** Whether a block runs on a Paris date: its recurrence, its season, and not an exception. */
export function blockRunsOn(block: GridBlock, date: string): boolean {
  const recurrence = block.recurrence ?? "weekly";
  if (recurrence === "once") {
    if (block.once_date !== date) return false;
  } else if (recurrence === "monthly") {
    if (!monthlyOn(block.monthly_rule, date)) return false;
  } else if (!((block.days_mask ?? 0) & (1 << weekdayIndex(date)))) return false;
  if (block.date_from && date < block.date_from) return false;
  if (block.date_to && date > block.date_to) return false;
  if (block.exceptions?.includes(date)) return false;
  return true;
}

/** The occurrence of a block starting on a Paris date, or null when the block doesn't run that day (or falls in the spring clock-change gap). */
export function occurrenceOn(block: GridBlock, date: string): Occurrence | null {
  if (!blockRunsOn(block, date)) return null;
  const startMs = parisWallClockToUtcMs(date, block.start_min);
  const endMs = runsPastMidnight(block)
    ? parisWallClockToUtcMs(addDaysTo(date, 1), block.end_min)
    : parisWallClockToUtcMs(date, block.end_min);
  if (endMs <= startMs) return null; // wholly inside the missing spring hour
  return { block, date, startMs, endMs, originMs: startMs };
}

/** Every occurrence (uncut) overlapping [fromMs, toMs). */
export function rawOccurrences(blocks: GridBlock[], fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  let date = addDaysTo(parisDate(fromMs), -1);
  const last = parisDate(toMs + DAY);
  // Up to about a year: the planner looks 48 h ahead and validation 14 days, but nothing should silently stop at a limit.
  for (let guard = 0; date <= last && guard < 400; guard++, date = addDaysTo(date, 1)) {
    for (const b of blocks) {
      if (!b.active) continue;
      const occ = occurrenceOn(b, date);
      if (occ && occ.endMs > fromMs && occ.startMs < toMs) out.push(occ);
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/**
 * The effective timeline (§2.2): every stretch of a block that actually airs
 * in [fromMs, toMs), in time order.
 *
 * - A higher layer cuts a lower one. The part of the lower block after the
 *   cut resumes as it would have been laid out from its own start (originMs).
 * - Within a layer, an overlap is a conflict (validation refuses to publish
 *   one); meanwhile, as in Release 1, the earlier-starting block wins and the
 *   later one starts when it ends.
 * - Time no stretch covers is the channel default.
 */
export function occurrencesBetween(blocks: GridBlock[], fromMs: number, toMs: number): Occurrence[] {
  const raw = rawOccurrences(blocks, fromMs, toMs);
  const layerOf = (o: Occurrence) => o.block.layer ?? 1;
  const claimed: [number, number][] = [];
  const pieces: Occurrence[] = [];
  const layers = [...new Set(raw.map(layerOf))].sort((a, b) => b - a);
  for (const layer of layers) {
    const sameLayer = raw.filter((o) => layerOf(o) === layer);
    // Within a layer: Release 1's rule (the later one starts when the earlier ends).
    const fixed: Occurrence[] = [];
    for (const o of sameLayer) {
      const prev = fixed[fixed.length - 1];
      if (prev && o.startMs < prev.endMs) {
        if (o.endMs > prev.endMs) fixed.push({ ...o, startMs: prev.endMs, originMs: prev.endMs });
      } else fixed.push(o);
    }
    for (const o of fixed) {
      // What's left of it once the higher layers have taken their time.
      let segs: [number, number][] = [[o.startMs, o.endMs]];
      for (const [a, b] of claimed) {
        const next: [number, number][] = [];
        for (const [s, e] of segs) {
          if (b <= s || a >= e) next.push([s, e]);
          else {
            if (a > s) next.push([s, a]);
            if (b < e) next.push([b, e]);
          }
        }
        segs = next;
      }
      for (const [s, e] of segs) {
        if (e <= s) continue;
        pieces.push({ ...o, startMs: s, endMs: e, originMs: o.originMs ?? o.startMs, cut: e < o.endMs });
      }
    }
    for (const o of fixed) claimed.push([o.startMs, o.endMs]);
  }
  return pieces.filter((o) => o.endMs > fromMs && o.startMs < toMs).sort((a, b) => a.startMs - b.startMs);
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
