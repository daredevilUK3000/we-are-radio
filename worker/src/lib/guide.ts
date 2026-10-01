import type { Channel, Env } from "./types";
import { loadGridBlocks, occurrencesBetween, type Occurrence } from "./scheduler/grid";
import { addDaysTo, DAY, HOUR, parisDate, parisWallClockToUtcMs } from "./scheduler/time";

/**
 * The public programme guide (handoff_tv_firetv.md §A3, in the response shape
 * of handoff_scheduler_release2.md §11.1). Release 1 has only the weekly grid,
 * so for now: weekly blocks, no layers, and any time no block covers is a
 * "channel default" span named after the channel. Scheduler Release 2 swaps
 * the source to its published plans; the shape stays the same.
 *
 * Never item-level content, programme IDs, tags or notes: names, one-line
 * descriptions and times only.
 */

export interface GuideSlot {
  block_id: string | null;
  name: string;
  description: string;
  starts_at: number; // Unix seconds
  ends_at: number;
  recurring: string | null; // "Every Friday"
  kind: "show" | "music" | "default";
}

export interface GuideChannel {
  slug: string;
  name: string;
  accent: string;
  slots: GuideSlot[];
}

// Kept in step with app/src/listener/lib/channelAccent.ts.
const ACCENTS: Record<string, string> = {
  "kizzi-radio": "#E11D2E",
  "we-are-love": "#E11D2E",
  "we-are-50s": "#F5B942",
  "we-are-after-dark": "#3E7CB1",
};
export const channelAccent = (slug: string) => ACCENTS[slug] ?? "#8B8B93";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Every Friday", "Every day", "Weekdays", "Weekends", "Fridays and Saturdays". */
export function recurringLabel(daysMask: number): string {
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => daysMask & (1 << d));
  if (days.length === 7) return "Every day";
  if (days.length === 5 && days.every((d) => d < 5)) return "Weekdays";
  if (days.length === 2 && days[0] === 5 && days[1] === 6) return "Weekends";
  if (days.length === 1) return `Every ${DAY_NAMES[days[0]]}`;
  const plural = days.map((d) => `${DAY_NAMES[d]}s`);
  return `${plural.slice(0, -1).join(", ")} and ${plural[plural.length - 1]}`;
}

const sec = (ms: number) => Math.round(ms / 1000);

/** A channel-default span, cut at Paris midnights so each day's list is self-contained. */
function defaultSpans(channel: Channel, fromMs: number, toMs: number): GuideSlot[] {
  const out: GuideSlot[] = [];
  let start = fromMs;
  while (start < toMs) {
    const midnight = parisWallClockToUtcMs(addDaysTo(parisDate(start), 1), 0);
    const end = Math.min(toMs, midnight);
    out.push({
      block_id: null,
      name: channel.name,
      description: channel.description ?? "",
      starts_at: sec(start),
      ends_at: sec(end),
      recurring: null,
      kind: "default",
    });
    start = end;
  }
  return out;
}

const slotFor = (o: Occurrence): GuideSlot => ({
  block_id: o.block.id,
  name: o.block.name,
  description: o.block.description,
  starts_at: sec(o.startMs),
  ends_at: sec(o.endMs),
  recurring: recurringLabel(o.block.days_mask),
  kind: o.block.colour === "purple" ? "show" : "music",
});

/** The guide for [today 00:00 Paris, + days). */
export async function buildGuide(env: Env, days: number, nowMs = Date.now()): Promise<{ generated_at: number; channels: GuideChannel[] }> {
  const fromMs = parisWallClockToUtcMs(parisDate(nowMs), 0);
  const toMs = parisWallClockToUtcMs(addDaysTo(parisDate(nowMs), days), 0);
  const { results: channels } = await env.DB.prepare(
    `SELECT ch.*, COALESCE(sc.enabled, 0) AS sched_enabled
     FROM channels ch LEFT JOIN sched_channels sc ON sc.channel_id = ch.id
     WHERE ch.status = 'live' ORDER BY ch.created_at ASC`
  ).all<Channel & { sched_enabled: number }>();

  const out: GuideChannel[] = [];
  for (const ch of channels) {
    const slots: GuideSlot[] = [];
    if (ch.sched_enabled) {
      const occs = occurrencesBetween(await loadGridBlocks(env.DB, ch.id), fromMs, toMs);
      let cursor = fromMs;
      for (const o of occs) {
        const start = Math.max(o.startMs, cursor);
        if (start > cursor) slots.push(...defaultSpans(ch, cursor, start));
        slots.push(slotFor(o));
        cursor = Math.max(cursor, o.endMs);
      }
      if (cursor < toMs) slots.push(...defaultSpans(ch, cursor, toMs));
    } else {
      // Not on the Scheduler: no blocks to show, one default span a day.
      slots.push(...defaultSpans(ch, fromMs, toMs));
    }
    out.push({ slug: ch.slug, name: ch.name, accent: channelAccent(ch.slug), slots });
  }
  return { generated_at: sec(nowMs), channels: out };
}

/** The block on a channel now, and the next one to start within `aheadMs`. */
export async function blocksAround(env: Env, channelId: string, nowMs: number, aheadMs = 6 * HOUR) {
  const occs = occurrencesBetween(await loadGridBlocks(env.DB, channelId), nowMs - DAY, nowMs + aheadMs);
  const cur = occs.find((o) => o.startMs <= nowMs && nowMs < o.endMs) ?? null;
  const next = occs.find((o) => o.startMs > nowMs) ?? null;
  return {
    block: cur ? { name: cur.block.name, description: cur.block.description, starts_at: sec(cur.startMs), ends_at: sec(cur.endMs) } : null,
    next_block: next ? { name: next.block.name, starts_at: sec(next.startMs), ends_at: sec(next.endMs) } : null,
  };
}
