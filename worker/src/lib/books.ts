import type { GridBlock } from "./scheduler/grid";
import { occurrencesBetween } from "./scheduler/grid";
import { parsePlanBlock } from "./scheduler/planEdit";
import { DAY, MINUTE, parisDate, WEEKDAY_SHORT, hhmm } from "./scheduler/time";
import { SHORT_LINK_BASE } from "./promos";

/**
 * Book of the Month (migrations/0028). One of Kizzi's books each month, with
 * a ~5-minute segment that airs only through the Scheduler: the Studio form
 * writes draft blocks (a playlist of the jingle then the segment) into the
 * working copy, and nothing airs until a channel is published. While the
 * segment or its jingle is on air, now-playing carries `book` (station.ts
 * enrichItems), as it carries `promo` for a house promo.
 */

export interface BookRow {
  id: string;
  month: string;
  title: string;
  author: string;
  blurb: string;
  cover_url: string | null;
  buy_url: string | null;
  buy_label: string;
  slug: string;
  segment_asset_id: string | null;
  jingle_asset_id: string | null;
  list_id: string | null;
  airings_json: string | null;
  status: "draft" | "scheduled" | "archived";
  created_at: string;
  updated_at: string;
}

/** What the players are told about a book on air (now-playing's `book`). */
export interface BookInfo {
  title: string;
  author: string;
  cover_url: string | null;
  /** The short link (/go/<slug>), which counts the click and redirects to the shop. */
  buy_url: string | null;
  buy_label: string;
  slug: string;
}

export const BOOK_PILL = "Book of the Month";
export const DEFAULT_AUTHOR = "Kizzi Nkwocha";
export const DEFAULT_BUY_LABEL = "Get the book";

export const bookInfo = (b: Pick<BookRow, "title" | "author" | "cover_url" | "buy_url" | "buy_label" | "slug">): BookInfo => ({
  title: b.title,
  author: b.author || DEFAULT_AUTHOR,
  cover_url: b.cover_url,
  buy_url: b.buy_url ? `${SHORT_LINK_BASE}${b.slug}` : null,
  buy_label: b.buy_label || DEFAULT_BUY_LABEL,
  slug: b.slug,
});

/** The Paris month an instant falls in, YYYY-MM. */
export const parisMonth = (ms: number) => parisDate(ms).slice(0, 7);

/**
 * Book details for the audio assets among these ids that are a book's
 * segment or jingle. The jingle is shared by every book: it belongs to the
 * month's book (its airings only run in their own month), else the latest
 * book before it.
 */
export async function bookInfoFor(db: D1Database, assetIds: string[], nowMs = Date.now()): Promise<Map<string, BookInfo>> {
  const out = new Map<string, BookInfo>();
  if (assetIds.length === 0) return out;
  const marks = assetIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM books WHERE segment_asset_id IN (${marks}) OR jingle_asset_id IN (${marks}) ORDER BY month DESC`)
    .bind(...assetIds, ...assetIds)
    .all<BookRow>();
  if (results.length === 0) return out;
  const month = parisMonth(nowMs);
  for (const id of assetIds) {
    const seg = results.find((b) => b.segment_asset_id === id);
    if (seg) {
      out.set(id, bookInfo(seg));
      continue;
    }
    const withJingle = results.filter((b) => b.jingle_asset_id === id);
    const pick = withJingle.find((b) => b.month === month) ?? withJingle.find((b) => b.month <= month) ?? withJingle[0];
    if (pick) out.set(id, bookInfo(pick));
  }
  return out;
}

/** Is a short link already used, by a promo or by another book? (/go/<slug> serves both.) */
export async function slugInUse(db: D1Database, slug: string, except: { bookId?: string; promoAssetId?: string } = {}): Promise<boolean> {
  const promo = await db.prepare("SELECT 1 FROM promos WHERE slug = ? AND audio_asset_id != ?").bind(slug, except.promoAssetId ?? "").first();
  if (promo) return true;
  const book = await db.prepare("SELECT 1 FROM books WHERE slug = ? AND id != ?").bind(slug, except.bookId ?? "").first();
  return !!book;
}

// ------------------------------------------------------------------ published plans

interface PublishedChannel {
  channel_id: string;
  channel_name: string;
  channel_slug: string;
  blocks: GridBlock[];
}

/** Every live channel's latest published plan blocks (read-only: never seeds a plan). */
export async function publishedPlans(db: D1Database): Promise<PublishedChannel[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS channel_id, c.name AS channel_name, c.slug AS channel_slug, p.plan_json
       FROM channels c JOIN sched_plans p ON p.channel_id = c.id
       WHERE c.status = 'live' AND p.number = (SELECT MAX(number) FROM sched_plans WHERE channel_id = c.id)
       ORDER BY c.created_at ASC`
    )
    .all<{ channel_id: string; channel_name: string; channel_slug: string; plan_json: string }>();
  return results.map((r) => {
    let blocks: GridBlock[] = [];
    try {
      blocks = ((JSON.parse(r.plan_json) as { blocks?: GridBlock[] }).blocks ?? []).filter((b) => b.active);
    } catch {
      blocks = [];
    }
    return { channel_id: r.channel_id, channel_name: r.channel_name, channel_slug: r.channel_slug, blocks };
  });
}

/** The channels whose published plan airs a book's playlist. */
export const channelsAiring = (plans: PublishedChannel[], listId: string | null) =>
  listId ? plans.filter((p) => p.blocks.some((b) => b.list_id === listId)) : [];

export interface NextAiring {
  starts_at: number; // Unix seconds
  channel_name: string;
  channel_slug: string;
}

/** A book's next airing from now in the published plans, within `days`; null if none. */
export function nextAiring(plans: PublishedChannel[], listId: string | null, nowMs: number, days = 7): NextAiring | null {
  if (!listId) return null;
  let best: NextAiring | null = null;
  for (const p of plans) {
    if (!p.blocks.some((b) => b.list_id === listId)) continue;
    // All the channel's blocks, so a higher layer that cuts into the book's airing is respected.
    const occ = occurrencesBetween(p.blocks, nowMs, nowMs + days * DAY).find((o) => o.block.list_id === listId && o.startMs >= nowMs);
    if (occ && (!best || occ.startMs < best.starts_at * 1000)) {
      best = { starts_at: Math.round(occ.startMs / 1000), channel_name: p.channel_name, channel_slug: p.channel_slug };
    }
  }
  return best;
}

/**
 * Keep `status` in step with the published plans: a draft whose airings are
 * now in a published plan is scheduled, and a scheduled book whose airings
 * were all removed is a draft again. Archived books are left alone.
 */
export async function syncBookStatuses(db: D1Database, plans: PublishedChannel[]): Promise<void> {
  const { results } = await db.prepare("SELECT id, list_id, status FROM books WHERE status != 'archived'").all<Pick<BookRow, "id" | "list_id" | "status">>();
  const stmts: D1PreparedStatement[] = [];
  for (const b of results) {
    const want = channelsAiring(plans, b.list_id).length > 0 ? "scheduled" : "draft";
    if (want !== b.status) stmts.push(db.prepare("UPDATE books SET status = ?, updated_at = ? WHERE id = ? AND status = ?").bind(want, new Date().toISOString(), b.id, b.status));
  }
  if (stmts.length) await db.batch(stmts);
}

// ------------------------------------------------------------------ draft airings

/** One airing pattern row: "Monday to Friday at 08:05". days_mask bit 0 = Monday ... bit 6 = Sunday. */
export interface AiringRow {
  days_mask: number;
  start_min: number;
}

export interface AiringSettings {
  /** Channel ids. */
  channels: string[];
  date_from: string;
  date_to: string;
  rows: AiringRow[];
}

const WEEKDAYS = 0b0011111;
const WEEKEND = 0b1100000;
/** Weekdays at 08:05 and 19:05, weekends at 14:05 (handoff §4.3). */
export const DEFAULT_ROWS: AiringRow[] = [
  { days_mask: WEEKDAYS, start_min: 8 * 60 + 5 },
  { days_mask: WEEKDAYS, start_min: 19 * 60 + 5 },
  { days_mask: WEEKEND, start_min: 14 * 60 + 5 },
];

/** The month's first and last day. */
export function monthDates(month: string): { date_from: string; date_to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { date_from: `${month}-01`, date_to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The block's length: the jingle and the segment, rounded up to the next 5 minutes. */
export const blockMinutes = (segmentSeconds: number, jingleSeconds: number) => Math.max(5, Math.ceil(((segmentSeconds + jingleSeconds) * 1000) / (5 * MINUTE)) * 5);

const dayName = (i: number) => WEEKDAY_SHORT[i];

/** Warnings, not blocks (handoff §4.3): more than twice a day, the same time every day, or two airings overlapping. */
export function airingWarnings(rows: AiringRow[], lengthMin: number): string[] {
  const out: string[] = [];
  for (let d = 0; d < 7; d++) {
    const n = rows.filter((r) => r.days_mask & (1 << d)).length;
    if (n > 2) out.push(`It would air ${n} times on ${dayName(d)}: twice a day is plenty for a 5-minute feature.`);
  }
  const byTime = new Map<number, number>();
  for (const r of rows) byTime.set(r.start_min, (byTime.get(r.start_min) ?? 0) | r.days_mask);
  for (const [t, mask] of byTime) if (mask === 127) out.push(`It would air at ${hhmm(t)} every day: listeners at that time would hear it daily. Try a different time at weekends.`);
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const shared = rows[i].days_mask & rows[j].days_mask;
      if (shared && Math.abs(rows[i].start_min - rows[j].start_min) < lengthMin) {
        out.push(`The ${hhmm(rows[i].start_min)} and ${hhmm(rows[j].start_min)} airings overlap: each takes ${lengthMin} minutes.`);
      }
    }
  }
  return out;
}

/**
 * The working-copy blocks for a book's airings: one per channel per pattern
 * row, each "days + time", seasonal (layer 2) for the dates given, filled by
 * the book's playlist, music filling any minutes left (handoff §4.3).
 * Flexible start and end: the song before it finishes naturally, and the
 * segment always plays to its end (scheduler/plan.ts).
 */
export function draftBlocks(
  book: Pick<BookRow, "title" | "author" | "blurb">,
  listId: string,
  settings: AiringSettings,
  lengthMin: number,
  newBlockId: () => string,
  nowMs: number
): { ok: true; blocks: GridBlock[] } | { ok: false; message: string } {
  const blocks: GridBlock[] = [];
  for (const channelId of settings.channels) {
    for (const row of settings.rows) {
      const end = (row.start_min + lengthMin) % 1440 || 1440;
      const parsed = parsePlanBlock({
        name: blockName(book.title),
        description: book.blurb.trim() || `${book.title} by ${book.author || DEFAULT_AUTHOR}`,
        colour: "gold",
        recurrence: "weekly",
        days_mask: row.days_mask,
        date_from: settings.date_from,
        date_to: settings.date_to,
        start_min: row.start_min,
        end_min: end,
        layer: 2,
        start_mode: "flexible",
        end_mode: "flexible",
        fill_kind: "playlist",
        list_id: listId,
        tags_any: [],
        when_short: "fill",
        public: 1,
        active: 1,
      });
      if (!parsed.ok) return { ok: false, message: `${hhmm(row.start_min)}: ${parsed.message}` };
      blocks.push({ ...parsed.value, id: newBlockId(), channel_id: channelId, created_at_ms: nowMs, updated_at_ms: nowMs });
    }
  }
  return { ok: true, blocks };
}

/** "Book of the Month: <title>", within the Scheduler's 60 characters for a name, ending on a whole word. */
export function blockName(title: string): string {
  const full = `Book of the Month: ${title}`;
  if (full.length <= 60) return full;
  const cut = full.slice(0, 59);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 59).replace(/[\s:,;&-]+$/, "")}…`;
}

/** "Mon-Fri at 08:05" */
export function describeRow(r: AiringRow): string {
  const days =
    r.days_mask === WEEKDAYS ? "Monday to Friday" : r.days_mask === WEEKEND ? "Saturday and Sunday" : r.days_mask === 127 ? "Every day" : WEEKDAY_SHORT.filter((_, i) => r.days_mask & (1 << i)).join(", ");
  return `${days} at ${hhmm(r.start_min)}`;
}
