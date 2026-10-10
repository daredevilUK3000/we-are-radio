import type { Channel } from "../types";
import { blockFillProblem, clockChangesBetween } from "./health";
import { occurrenceLabel, occurrencesBetween, rawOccurrences, type GridBlock, type Occurrence } from "./grid";
import { DAY, HOUR, hhmm, parisDate, parisHHMM, weekdayIndex } from "./time";

/**
 * Plan validation (handoff §2.5). Red issues stop a channel's Publish; amber
 * ones are shown but don't. Structural checks cover every block; occurrence
 * checks cover the next 14 days. The Timeline draws the same issues in
 * place, and Schedule Health shows the next 48 hours of them.
 */

export type FixKind = "move" | "shorten" | "replace" | "exception" | "edit";

export interface PlanIssue {
  level: "red" | "amber";
  code: "conflict" | "cant_fill" | "repeat_risk" | "flex_drift" | "clock_change" | "past" | "no_airings";
  text: string;
  block_id?: string;
  /** The other block in a conflict. */
  other_block_id?: string;
  /** The first Paris date it happens on. */
  date?: string;
  start_ms?: number;
  end_ms?: number;
  fixes: FixKind[];
}

export const LOOKAHEAD_MS = 14 * DAY;
const WEEKDAY_PLURAL = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const DAY_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 16 Oct" */
export const shortDate = (date: string) => `${DAY_LONG[weekdayIndex(date)]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const span = (b: GridBlock) => `${hhmm(b.start_min)}–${hhmm(b.end_min)}`;
const kindWord = (b: GridBlock) => ((b.recurrence ?? "weekly") === "once" ? "one-off" : b.date_from || b.date_to ? "seasonal" : (b.recurrence ?? "weekly") === "monthly" ? "monthly" : "recurring");

export async function validatePlan(db: D1Database, channel: Channel, blocks: GridBlock[], nowMs: number): Promise<PlanIssue[]> {
  const issues: PlanIssue[] = [];
  const active = blocks.filter((b) => b.active);
  const toMs = nowMs + LOOKAHEAD_MS;
  const today = parisDate(nowMs);

  // ---- Same-layer overlaps (conflicts), one issue per pair of blocks.
  const raw = rawOccurrences(active, nowMs, toMs);
  const pairs = new Map<string, { a: Occurrence; b: Occurrence; dates: string[] }>();
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const a = raw[i];
      const b = raw[j];
      if (b.startMs >= a.endMs) break; // sorted by start: nothing later overlaps a
      if (a.block.id === b.block.id || (a.block.layer ?? 1) !== (b.block.layer ?? 1)) continue;
      const key = [a.block.id, b.block.id].sort().join("|");
      const hit = pairs.get(key);
      if (hit) hit.dates.push(a.date);
      else pairs.set(key, { a, b, dates: [a.date] });
    }
  }
  for (const { a, b, dates } of pairs.values()) {
    const bothRecurring = (a.block.recurrence ?? "weekly") !== "once" && (b.block.recurrence ?? "weekly") !== "once";
    const days = [...new Set(dates.map((d) => weekdayIndex(d)))].sort().map((d) => WEEKDAY_PLURAL[d]);
    const when = bothRecurring ? `both ${kindWord(a.block) === kindWord(b.block) ? kindWord(a.block) : "repeating"}, ${days.join(", ")}` : shortDate(dates[0]);
    issues.push({
      level: "red",
      code: "conflict",
      text: `${a.block.name} ${span(a.block)} overlaps ${b.block.name} ${span(b.block)} (${when})`,
      block_id: a.block.id,
      other_block_id: b.block.id,
      date: dates[0],
      start_ms: Math.max(a.startMs, b.startMs),
      end_ms: Math.min(a.endMs, b.endMs),
      fixes: bothRecurring ? ["move", "shorten", "replace", "exception"] : ["move", "shorten", "replace"],
    });
  }

  // ---- Can every block be filled? (One check per distinct fill.)
  const fillCache = new Map<string, Awaited<ReturnType<typeof blockFillProblem>>>();
  for (const b of active) {
    const key = `${b.fill_kind}|${b.programme_id}|${b.tags_any_json}|${b.start_min}|${b.end_min}`;
    if (!fillCache.has(key)) fillCache.set(key, await blockFillProblem(db, channel, b));
    const problem = fillCache.get(key);
    if (!problem) continue;
    issues.push({
      level: problem.level,
      code: problem.level === "red" ? "cant_fill" : "repeat_risk",
      text: problem.level === "red" ? `${b.name} can't be filled: ${problem.text}` : `${b.name}: ${problem.text}`,
      block_id: b.id,
      fixes: ["edit"],
    });
  }

  // ---- Blocks that will never air again.
  for (const b of active) {
    const rec = b.recurrence ?? "weekly";
    if (rec === "once" && b.once_date && b.once_date < today) {
      issues.push({ level: "amber", code: "past", text: `${b.name} was a one-off on ${shortDate(b.once_date)}: it's over`, block_id: b.id, fixes: ["replace"] });
    } else if (rec !== "once" && b.date_to && b.date_to < today) {
      issues.push({ level: "amber", code: "past", text: `${b.name}'s season ended on ${shortDate(b.date_to)}`, block_id: b.id, fixes: ["edit", "replace"] });
    }
  }

  // ---- Flexible hand-overs: the next block starts when the last song ends.
  const effective = occurrencesBetween(active, nowMs, toMs);
  const flexSeen = new Set<string>();
  for (let i = 0; i + 1 < effective.length; i++) {
    const a = effective[i];
    const b = effective[i + 1];
    if (a.cut || b.startMs !== a.endMs || a.block.end_mode !== "flexible" || b.block.start_mode !== "flexible") continue;
    const key = `${a.block.id}|${b.block.id}`;
    if (flexSeen.has(key)) continue;
    flexSeen.add(key);
    issues.push({
      level: "amber",
      code: "flex_drift",
      text: `${a.block.name} ends flexibly into ${b.block.name}: its last song plays out, so ${b.block.name} starts a few minutes after ${parisHHMM(b.startMs)}`,
      block_id: b.block.id,
      other_block_id: a.block.id,
      date: b.date,
      fixes: [],
    });
  }

  // ---- Clock changes in the next 14 days that land in a block.
  for (const ch of clockChangesBetween(nowMs, toMs)) {
    for (const o of effective.filter((o) => o.startMs <= ch.at + HOUR && o.endMs >= ch.at - HOUR)) {
      issues.push({
        level: "amber",
        code: "clock_change",
        text: ch.spring
          ? `${o.block.name} (${occurrenceLabel(o)}) loses an hour when summer time starts`
          : `${o.block.name} (${occurrenceLabel(o)}) runs an hour longer in real time when the clocks go back`,
        block_id: o.block.id,
        date: o.date,
        fixes: [],
      });
    }
  }
  return issues;
}

export const redIssues = (issues: PlanIssue[]) => issues.filter((i) => i.level === "red");
