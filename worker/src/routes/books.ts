import { Hono } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import {
  airingWarnings,
  blockMinutes,
  blockName,
  bookInfo,
  channelsAiring,
  DEFAULT_AUTHOR,
  DEFAULT_BUY_LABEL,
  DEFAULT_ROWS,
  describeRow,
  draftBlocks,
  monthDates,
  nextAiring,
  parisMonth,
  publishedPlans,
  slugInUse,
  syncBookStatuses,
  type AiringRow,
  type AiringSettings,
  type BookRow,
} from "../lib/books";
import { SHORT_LINK_BASE } from "../lib/promos";
import { writeListStatements, type SnapshotList } from "../lib/scheduler/content";
import { newBlockId, writeBlockStatements } from "../lib/scheduler/planEdit";
import { DAY } from "../lib/scheduler/time";

/**
 * Book of the Month (migrations/0028, lib/books.ts).
 * - bookStudioRoutes: the Audio page's Book of the Month tab and its form.
 *   "Create draft airings" writes blocks into the Scheduler's working copy
 *   only; nothing airs until the channel is published on the Timeline.
 * - bookPublicRoutes: the landing card and /books.
 * Short links are served by routes/promos.ts (/go/<slug>, promos and books alike).
 */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JINGLE_SETTING = "botm_jingle_asset_id";

const linkOk = (u: string) => {
  try {
    return /^https:\/\//i.test(u) && !!new URL(u).hostname && u.length <= 500;
  } catch {
    return false;
  }
};

const parseAirings = (json: string | null): AiringSettings | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as AiringSettings;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- Studio

export const bookStudioRoutes = new Hono<{ Bindings: Env }>();

// Every book, newest month first, with its airings, on-demand plays and clicks; plus what the form needs.
bookStudioRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const plans = await publishedPlans(db);
  await syncBookStatuses(db, plans);
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const { results } = await db
    .prepare(
      `SELECT b.*,
              s.title AS segment_title, s.duration_seconds AS segment_seconds, s.audio_url AS segment_audio_url,
              j.title AS jingle_title, j.duration_seconds AS jingle_seconds,
              (SELECT COUNT(*) FROM sched_aired a WHERE a.audio_asset_id = b.segment_asset_id AND a.starts_at_ms <= ?1) AS airings,
              (SELECT COUNT(*) FROM book_preview_events e WHERE e.book_id = b.id) AS listens,
              (SELECT COUNT(*) FROM book_clicks k WHERE k.book_id = b.id AND k.timestamp >= ?2) AS clicks_7d,
              (SELECT COUNT(*) FROM book_clicks k WHERE k.book_id = b.id) AS clicks_all,
              (SELECT COUNT(*) FROM sched_blocks sb WHERE sb.list_id = b.list_id AND b.list_id IS NOT NULL) AS draft_blocks
       FROM books b
       LEFT JOIN audio_assets s ON s.id = b.segment_asset_id
       LEFT JOIN audio_assets j ON j.id = b.jingle_asset_id
       ORDER BY b.month DESC`
    )
    .bind(now, weekAgo)
    .all<BookRow & Record<string, unknown>>();
  const { results: channels } = await db.prepare("SELECT id, name, slug FROM channels WHERE status = 'live' ORDER BY created_at ASC").all();
  // Segments and jingles are 'feature' assets: anything uploaded for it, or already in the library (not Time Capsule recordings).
  const { results: features } = await db
    .prepare(
      `SELECT id, title, duration_seconds, audio_url, status FROM audio_assets a
       WHERE type = 'feature' AND COALESCE(storage, 'r2') = 'r2' AND NOT EXISTS (SELECT 1 FROM time_capsules tc WHERE tc.audio_asset_id = a.id)
       ORDER BY created_at DESC`
    )
    .all();
  const jingle = await db.prepare("SELECT value FROM station_settings WHERE key = ?").bind(JINGLE_SETTING).first<{ value: string }>();
  return c.json({
    books: results.map((b) => ({
      ...b,
      airings_json: undefined,
      airing_settings: parseAirings(b.airings_json),
      short_url: `${SHORT_LINK_BASE}${b.slug}`,
      published_on: channelsAiring(plans, b.list_id).map((p) => p.channel_name),
      next_airing: nextAiring(plans, b.list_id, now, 45),
    })),
    channels,
    features,
    jingle_asset_id: jingle?.value ?? null,
    default_rows: DEFAULT_ROWS,
    current_month: parisMonth(now),
  });
});

interface BookBody {
  month?: string;
  title?: string;
  author?: string;
  blurb?: string;
  cover_url?: string | null;
  buy_url?: string;
  buy_label?: string;
  slug?: string;
  segment_asset_id?: string | null;
  jingle_asset_id?: string | null;
}

/** A book's fields from the form, checked; the message is for Kizzi. */
async function parseBook(db: D1Database, b: BookBody, bookId: string | null): Promise<{ ok: true; value: Omit<BookRow, "id" | "list_id" | "airings_json" | "status" | "created_at" | "updated_at"> } | { ok: false; status: 400 | 409; message: string }> {
  const bad = (message: string, status: 400 | 409 = 400) => ({ ok: false as const, status, message });
  const month = String(b.month ?? "").trim();
  if (!MONTH.test(month)) return bad("Choose the month.");
  const other = await db.prepare("SELECT title FROM books WHERE month = ? AND id != ?").bind(month, bookId ?? "").first<{ title: string }>();
  if (other) return bad(`${other.title} is already the Book of the Month for that month.`, 409);
  const title = String(b.title ?? "").replace(/\s+/g, " ").trim();
  if (!title || title.length > 120) return bad("The book needs a title, up to 120 characters.");
  const author = String(b.author ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || DEFAULT_AUTHOR;
  const blurb = String(b.blurb ?? "").replace(/\s+/g, " ").trim();
  if (blurb.length > 300) return bad("Keep the blurb to one or two lines (300 characters).");
  const buy = String(b.buy_url ?? "").trim();
  if (!linkOk(buy)) return bad("The purchase link must be a full https:// address.");
  const label = String(b.buy_label ?? "").trim() || DEFAULT_BUY_LABEL;
  if (label.length > 30) return bad("Keep the button label to 30 characters.");
  const slug = String(b.slug ?? "").trim().toLowerCase();
  if (!SLUG.test(slug)) return bad("The short link needs lower-case letters, numbers and hyphens, e.g. ikigai.");
  if (await slugInUse(db, slug, { bookId: bookId ?? undefined })) return bad(`weareradio.app/go/${slug} is already used by a promo or another book.`, 409);
  const cover = b.cover_url ? String(b.cover_url).slice(0, 300) : null;
  // The segment and the jingle are features, so they never air from the jingle pool or any rotation.
  const asset = async (id: string | null | undefined, what: string) => {
    if (!id) return { ok: true as const, id: null };
    const a = await db.prepare("SELECT type FROM audio_assets WHERE id = ?").bind(id).first<{ type: string }>();
    if (!a) return { ok: false as const, message: `That ${what} no longer exists.` };
    if (a.type !== "feature") return { ok: false as const, message: `The ${what} must be uploaded as a feature (it's a ${a.type}), so it only airs with the book.` };
    return { ok: true as const, id };
  };
  const seg = await asset(b.segment_asset_id, "segment");
  if (!seg.ok) return bad(seg.message);
  const jin = await asset(b.jingle_asset_id, "jingle");
  if (!jin.ok) return bad(jin.message);
  return {
    ok: true,
    value: { month, title, author, blurb, cover_url: cover, buy_url: buy, buy_label: label, slug, segment_asset_id: seg.id, jingle_asset_id: jin.id },
  };
}

const rememberJingle = (db: D1Database, id: string | null) =>
  id
    ? db
        .prepare(`INSERT INTO station_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3`)
        .bind(JINGLE_SETTING, id, nowIso())
        .run()
    : Promise.resolve();

bookStudioRoutes.post("/", async (c) => {
  const body = await c.req.json<BookBody>().catch(() => ({}) as BookBody);
  const parsed = await parseBook(c.env.DB, body, null);
  if (!parsed.ok) return c.json({ error: parsed.message }, parsed.status);
  const v = parsed.value;
  const id = newId("botm");
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO books (id, month, title, author, blurb, cover_url, buy_url, buy_label, slug, segment_asset_id, jingle_asset_id, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`
  )
    .bind(id, v.month, v.title, v.author, v.blurb, v.cover_url, v.buy_url, v.buy_label, v.slug, v.segment_asset_id, v.jingle_asset_id, now, now)
    .run();
  await rememberJingle(c.env.DB, v.jingle_asset_id);
  return c.json({ ok: true, id });
});

bookStudioRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM books WHERE id = ?").bind(id).first<BookRow>();
  if (!existing) return c.json({ error: "That book no longer exists." }, 404);
  const body = await c.req.json<BookBody>().catch(() => ({}) as BookBody);
  const parsed = await parseBook(c.env.DB, body, id);
  if (!parsed.ok) return c.json({ error: parsed.message }, parsed.status);
  const v = parsed.value;
  await c.env.DB.prepare(
    `UPDATE books SET month = ?, title = ?, author = ?, blurb = ?, cover_url = ?, buy_url = ?, buy_label = ?, slug = ?,
       segment_asset_id = ?, jingle_asset_id = ?, updated_at = ? WHERE id = ?`
  )
    .bind(v.month, v.title, v.author, v.blurb, v.cover_url, v.buy_url, v.buy_label, v.slug, v.segment_asset_id, v.jingle_asset_id, nowIso(), id)
    .run();
  await rememberJingle(c.env.DB, v.jingle_asset_id);
  return c.json({ ok: true, id });
});

/** The airing settings from the form, checked. */
async function parseAiringSettings(db: D1Database, raw: Record<string, unknown>): Promise<{ ok: true; value: AiringSettings } | { ok: false; message: string }> {
  const { results } = await db.prepare("SELECT id FROM channels WHERE status = 'live'").all<{ id: string }>();
  const live = new Set(results.map((r) => r.id));
  const channels = Array.isArray(raw.channels) ? [...new Set(raw.channels.filter((x): x is string => typeof x === "string" && live.has(x)))] : [];
  if (channels.length === 0) return { ok: false, message: "Choose at least one channel." };
  const date_from = String(raw.date_from ?? "");
  const date_to = String(raw.date_to ?? "");
  if (!DATE.test(date_from) || !DATE.test(date_to)) return { ok: false, message: "Choose the first and last day." };
  if (date_to < date_from) return { ok: false, message: "The last day comes before the first." };
  const rowsIn = Array.isArray(raw.rows) ? raw.rows : [];
  const rows: AiringRow[] = [];
  for (const r of rowsIn as Record<string, unknown>[]) {
    const days_mask = Number(r?.days_mask);
    const start_min = Number(r?.start_min);
    if (!Number.isInteger(days_mask) || days_mask < 1 || days_mask > 127) return { ok: false, message: "Each airing needs at least one day." };
    if (!Number.isInteger(start_min) || start_min < 0 || start_min > 1435 || start_min % 5) return { ok: false, message: "Airing times go in 5-minute steps, e.g. 08:05." };
    rows.push({ days_mask, start_min });
  }
  if (rows.length === 0) return { ok: false, message: "Add at least one airing." };
  if (rows.length > 6) return { ok: false, message: "That's more than 6 airings: keep it to once or twice a day." };
  return { ok: true, value: { channels, date_from, date_to, rows } };
}

/**
 * PUT /:id/airings {channels, date_from, date_to, rows[, dry]}
 * "Create draft airings": the book's playlist (the jingle, then the segment)
 * and one working-copy block per channel per row, replacing the book's
 * previous draft blocks. Nothing airs until each channel is published.
 * With dry: what it would write, and the warnings, without writing.
 */
bookStudioRoutes.put("/:id/airings", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const book = await db.prepare("SELECT * FROM books WHERE id = ?").bind(id).first<BookRow>();
  if (!book) return c.json({ error: "That book no longer exists." }, 404);
  const raw = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const parsed = await parseAiringSettings(db, raw);
  if (!parsed.ok) return c.json({ error: parsed.message }, 400);
  const settings = parsed.value;
  if (!book.segment_asset_id) return c.json({ error: "Add the segment first." }, 400);
  const seg = await db.prepare("SELECT duration_seconds, status FROM audio_assets WHERE id = ?").bind(book.segment_asset_id).first<{ duration_seconds: number | null; status: string }>();
  if (!seg?.duration_seconds) return c.json({ error: "The segment's length isn't known yet: upload it again." }, 400);
  const jin = book.jingle_asset_id
    ? await db.prepare("SELECT duration_seconds FROM audio_assets WHERE id = ?").bind(book.jingle_asset_id).first<{ duration_seconds: number | null }>()
    : null;
  const lengthMin = blockMinutes(seg.duration_seconds, jin?.duration_seconds ?? 0);
  const warnings = airingWarnings(settings.rows, lengthMin);
  if (seg.status !== "published") warnings.push("The segment's audio is switched off in the library: switch it on, or it won't play.");

  const listId = book.list_id ?? newId("lst");
  const nowMs = Date.now();
  const built = draftBlocks(book, listId, settings, lengthMin, newBlockId, nowMs);
  if (!built.ok) return c.json({ error: built.message }, 400);
  const { results: chans } = await db.prepare("SELECT id, name FROM channels").all<{ id: string; name: string }>();
  const nameOf = (cid: string) => chans.find((x) => x.id === cid)?.name ?? cid;
  const summary = {
    length_min: lengthMin,
    blocks: built.blocks.length,
    rows: settings.rows.map(describeRow),
    channels: settings.channels.map(nameOf),
    warnings,
  };
  if (raw.dry) return c.json({ ok: true, dry: true, ...summary });

  const list: SnapshotList = {
    id: listId,
    kind: "playlist",
    name: blockName(book.title),
    description: `${book.title} by ${book.author}. Made by the Book of the Month form.`.slice(0, 200),
    length_ms: null,
    archived: 0,
    updated_at_ms: nowMs,
    slots: [
      ...(book.jingle_asset_id
        ? [{ position: 1, slot_kind: "fixed" as const, track_id: null, audio_asset_id: book.jingle_asset_id, rule_json: null, label: "Book of the Month jingle", at_ms: null }]
        : []),
      { position: 2, slot_kind: "fixed" as const, track_id: null, audio_asset_id: book.segment_asset_id, rule_json: null, label: "Book of the Month", at_ms: null },
    ],
  };
  // The previous draft blocks go; the new ones replace them (the published plan is untouched until Kizzi publishes).
  const { results: old } = await db.prepare("SELECT id FROM sched_blocks WHERE list_id = ?").bind(listId).all<{ id: string }>();
  await db.batch([
    ...writeListStatements(db, list),
    ...old.flatMap((o) => [db.prepare("DELETE FROM sched_block_exceptions WHERE block_id = ?").bind(o.id), db.prepare("DELETE FROM sched_blocks WHERE id = ?").bind(o.id)]),
    ...built.blocks.flatMap((b) => writeBlockStatements(db, b)),
    db.prepare("UPDATE books SET list_id = ?, airings_json = ?, updated_at = ? WHERE id = ?").bind(listId, JSON.stringify(settings), nowIso(), id),
  ]);
  return c.json({ ok: true, ...summary });
});

// Archive (kept on /books, short link still works) or bring back.
bookStudioRoutes.put("/:id/archived", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<{ archived?: boolean }>().catch(() => ({}) as { archived?: boolean });
  const res = await c.env.DB.prepare("UPDATE books SET status = ?, updated_at = ? WHERE id = ?").bind(b.archived ? "archived" : "draft", nowIso(), id).run();
  if (!res.meta.changes) return c.json({ error: "That book no longer exists." }, 404);
  // Back from the archive: draft or scheduled, as its airings say.
  if (!b.archived) await syncBookStatuses(c.env.DB, await publishedPlans(c.env.DB));
  return c.json({ ok: true });
});

/**
 * DELETE /:id[?confirm=1]: the book, its draft blocks and its playlist. If
 * its airings are in a published plan, it asks first (409 + the channels):
 * once deleted, they come off air when those channels are next published.
 */
bookStudioRoutes.delete("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const book = await db.prepare("SELECT * FROM books WHERE id = ?").bind(id).first<BookRow>();
  if (!book) return c.json({ ok: true });
  const published = channelsAiring(await publishedPlans(db), book.list_id).map((p) => p.channel_name);
  if (published.length && c.req.query("confirm") !== "1") {
    return c.json({ error: "published", channels: published }, 409);
  }
  const { results: blocks } = book.list_id ? await db.prepare("SELECT id FROM sched_blocks WHERE list_id = ?").bind(book.list_id).all<{ id: string }>() : { results: [] as { id: string }[] };
  await db.batch([
    ...blocks.flatMap((o) => [db.prepare("DELETE FROM sched_block_exceptions WHERE block_id = ?").bind(o.id), db.prepare("DELETE FROM sched_blocks WHERE id = ?").bind(o.id)]),
    // The playlist is archived, not deleted: published plans carry their own copy of it.
    ...(book.list_id ? [db.prepare("UPDATE sched_lists SET archived = 1, updated_at_ms = ? WHERE id = ?").bind(Date.now(), book.list_id)] : []),
    db.prepare("DELETE FROM books WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true, published_channels: published });
});

// ---------------------------------------------------------------- public

export const bookPublicRoutes = new Hono<{ Bindings: Env }>();

type PublicBook = ReturnType<typeof publicBook>;

const publicBook = (b: BookRow & { audio_url: string | null; duration_seconds: number | null }) => ({
  id: b.id,
  month: b.month,
  ...bookInfo(b),
  blurb: b.blurb,
  /** The segment, for Listen now (on demand, never a station play). */
  audio_url: b.audio_url,
  duration_seconds: b.duration_seconds,
});

async function publicBooks(db: D1Database, nowMs: number): Promise<{ books: PublicBook[]; current: PublicBook | null; currentListId: string | null; plans: Awaited<ReturnType<typeof publishedPlans>> }> {
  const plans = await publishedPlans(db);
  await syncBookStatuses(db, plans).catch(() => {});
  const month = parisMonth(nowMs);
  // Scheduled and archived books up to this month; a later month's book waits for its month.
  const { results } = await db
    .prepare(
      `SELECT b.*, a.audio_url, a.duration_seconds FROM books b
       LEFT JOIN audio_assets a ON a.id = b.segment_asset_id AND a.status = 'published'
       WHERE b.status IN ('scheduled','archived') AND b.month <= ? ORDER BY b.month DESC`
    )
    .bind(month)
    .all<BookRow & { audio_url: string | null; duration_seconds: number | null }>();
  const cur = results.find((b) => b.month === month && b.status === "scheduled") ?? null;
  return { books: results.map(publicBook), current: cur ? publicBook(cur) : null, currentListId: cur?.list_id ?? null, plans };
}

/** GET /api/books/current - the landing card: this month's book (if its airings are published) and its next airing within 7 days. */
bookPublicRoutes.get("/current", async (c) => {
  const cacheKey = new Request(`${new URL(c.req.url).origin}/api/books/current`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) return hit;
  const now = Date.now();
  const { books, current, currentListId, plans } = await publicBooks(c.env.DB, now);
  const res = c.json(
    { book: current ? { ...current, next_airing: nextAiring(plans, currentListId, now, 7) } : null, more: books.length > 1 },
    200,
    { "Cache-Control": "public, max-age=60" }
  );
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
});

/** GET /api/books - /books: the current book first, then every past month's, newest first. */
bookPublicRoutes.get("/", async (c) => {
  const now = Date.now();
  const { books, current, currentListId, plans } = await publicBooks(c.env.DB, now);
  return c.json(
    { books, current_id: current?.id ?? null, next_airing: current ? nextAiring(plans, currentListId, now, 7) : null },
    200,
    { "Cache-Control": "public, max-age=60" }
  );
});
