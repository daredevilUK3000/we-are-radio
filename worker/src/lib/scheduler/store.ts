import { newId } from "../id";
import { contentKey, type PlanItem } from "./types";

/**
 * Build-before-swap: the one way anything reaches the air.
 *
 * 1. A version row is written as 'building', with its items. Nothing reads
 *    'building' rows.
 * 2. The items are read back from D1 and checked (contiguous, audio, lengths,
 *    content still published).
 * 3. One compare-and-swap UPDATE publishes it - only if no one else has
 *    published since this build began. The partial unique index on
 *    (channel_id, number) means two versions can never both be number N.
 * Anything that fails leaves the live log untouched and the version 'failed'.
 */

export type VersionKind =
  | "generate"
  | "extend"
  | "play_now"
  | "skip"
  | "insert_next"
  | "replace"
  | "insert_jingle"
  | "record_link"
  | "back_on_schedule"
  | "rollback"
  | "grid";

export interface VersionRow {
  id: string;
  channel_id: string;
  number: number;
  status: "building" | "published" | "failed";
  effective_from_ms: number;
  horizon_ms: number;
  kind: VersionKind;
  actor: "studio" | "generator" | "system";
  based_on_version_id: string | null;
  rollback_of_version_id: string | null;
  summary: string;
  item_count: number | null;
  error: string | null;
  created_at_ms: number;
  published_at_ms: number | null;
  anchor_ms: number | null;
}

export interface LogItemRow {
  id: number;
  version_id: string;
  airing_id: string;
  starts_at_ms: number;
  ends_at_ms: number;
  offset_ms: number;
  item_type: string;
  track_id: string | null;
  audio_asset_id: string | null;
  label: string | null;
  audio_url: string;
  artwork_url: string | null;
  file_duration_ms: number;
  overlays_json: string | null;
  block_id: string | null;
  block_date: string | null;
  source: PlanItem["source"];
  source_ref: string | null;
  reason_json: string | null;
}

export const rowToItem = (r: LogItemRow): PlanItem => ({
  startsAt: r.starts_at_ms,
  endsAt: r.ends_at_ms,
  offset: r.offset_ms,
  itemType: r.item_type,
  trackId: r.track_id,
  assetId: r.audio_asset_id,
  label: r.label,
  audioUrl: r.audio_url,
  artworkUrl: r.artwork_url,
  fileMs: r.file_duration_ms,
  overlays: r.overlays_json ? JSON.parse(r.overlays_json) : undefined,
  blockId: r.block_id,
  blockDate: r.block_date,
  source: r.source,
  sourceRef: r.source_ref,
  reasons: r.reason_json ? JSON.parse(r.reason_json) : [],
  airingId: r.airing_id,
});

/** A sched_changes row to write when the version publishes. `item` is resolved to its airing ID then. */
export interface PendingChange {
  action: string;
  item?: PlanItem;
  airingId?: string | null;
  before?: unknown;
  after?: unknown;
  reason: string;
}

export interface PublishRequest {
  channelId: string;
  kind: VersionKind;
  actor: VersionRow["actor"];
  summary: string;
  effectiveFrom: number;
  items: PlanItem[];
  basedOn: VersionRow | null;
  /** Items the new version replaces from effectiveFrom on (the live timeline), for keeping airing IDs. */
  baseItems: PlanItem[];
  /** The live version number the build started from; publishing fails if it has moved. */
  expectedMax: number;
  rollbackOf?: string | null;
  /** Live controls: the time the recovery keeps. */
  anchorMs?: number | null;
  changes?: PendingChange[];
  /** The precise action (Release 2: publish, plan_rollback, hold...); kind stays the coarse category. */
  action?: string | null;
  /**
   * Statements that must commit with the swap or not at all (a published
   * plan's row). They run in the same batch, right after it, and should be
   * guarded with WHERE EXISTS (the version is published).
   */
  alongside?: (versionId: string) => D1PreparedStatement[];
  nowMs?: number;
  /** Set only by tests: publish nothing, fail validation with this message. */
  forceInvalid?: string;
}

export type PublishResult =
  | { ok: true; version: VersionRow }
  | { ok: false; conflict: boolean; error: string; versionId?: string };

/**
 * The same airing keeps its airing_id in every version (players restart
 * audio when the ID changes). Same content at the same logical start (the
 * file's start: startsAt - offset) = same airing. Content that moves keeps
 * its ID only if it hasn't started yet.
 */
export function assignAiringIds(items: PlanItem[], base: PlanItem[], nowMs: number): PlanItem[] {
  const byExact = new Map<string, PlanItem[]>();
  for (const b of base) {
    if (!b.airingId) continue;
    const k = `${contentKey(b)}@${b.startsAt - b.offset}`;
    byExact.set(k, [...(byExact.get(k) ?? []), b]);
  }
  const used = new Set<string>();
  const out = items.map((i) => {
    const k = `${contentKey(i)}@${i.startsAt - i.offset}`;
    const hit = byExact.get(k)?.find((b) => !used.has(b.airingId!));
    if (hit) {
      used.add(hit.airingId!);
      return { ...i, airingId: hit.airingId };
    }
    return { ...i, airingId: undefined as string | undefined };
  });
  // Moved but not yet started: keep the ID.
  const waiting = new Map<string, PlanItem[]>();
  for (const b of base) {
    if (!b.airingId || used.has(b.airingId) || b.startsAt <= nowMs) continue;
    const k = contentKey(b);
    waiting.set(k, [...(waiting.get(k) ?? []), b]);
  }
  return out.map((i) => {
    if (i.airingId) return i;
    if (i.startsAt > nowMs) {
      const cand = waiting.get(contentKey(i))?.find((b) => !used.has(b.airingId!));
      if (cand) {
        used.add(cand.airingId!);
        return { ...i, airingId: cand.airingId };
      }
    }
    return { ...i, airingId: newId("air") };
  });
}

const ITEM_COLUMNS = [
  "version_id", "airing_id", "starts_at_ms", "ends_at_ms", "offset_ms", "item_type", "track_id", "audio_asset_id", "label",
  "audio_url", "artwork_url", "file_duration_ms", "overlays_json", "block_id", "block_date", "source", "source_ref", "reason_json",
];
// D1 allows 100 bound parameters per statement: 5 rows x 18 columns.
const ROWS_PER_INSERT = 5;
const STATEMENTS_PER_BATCH = 50;

const itemValues = (versionId: string, i: PlanItem) => [
  versionId, i.airingId!, i.startsAt, i.endsAt, i.offset, i.itemType, i.trackId, i.assetId, i.label,
  i.audioUrl, i.artworkUrl, i.fileMs, i.overlays?.length ? JSON.stringify(i.overlays) : null, i.blockId, i.blockDate,
  i.source, i.sourceRef, i.reasons.length ? JSON.stringify(i.reasons) : null,
];

export async function liveMax(db: D1Database, channelId: string): Promise<number> {
  const r = await db
    .prepare("SELECT COALESCE(MAX(number), 0) AS n FROM sched_versions WHERE channel_id = ? AND status = 'published'")
    .bind(channelId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function publishVersion(db: D1Database, req: PublishRequest): Promise<PublishResult> {
  const now = req.nowMs ?? Date.now();
  const versionId = newId("ver");
  const items = assignAiringIds(req.items, req.baseItems, now);
  const horizon = items.length ? items[items.length - 1].endsAt : req.effectiveFrom;

  const run = await db
    .prepare("INSERT INTO sched_runs (channel_id, kind, started_at_ms, version_id) VALUES (?,?,?,?) RETURNING id")
    .bind(req.channelId, req.kind === "generate" || req.kind === "extend" ? req.kind : "action", now, versionId)
    .first<{ id: number }>();
  const finishRun = (ok: boolean, error: string | null) =>
    db.prepare("UPDATE sched_runs SET finished_at_ms = ?, ok = ?, error = ? WHERE id = ?").bind(Date.now(), ok ? 1 : 0, error, run!.id).run();

  const fail = async (error: string, conflict = false): Promise<PublishResult> => {
    await db.batch([
      db.prepare("UPDATE sched_versions SET status = 'failed', error = ? WHERE id = ? AND status = 'building'").bind(error.slice(0, 500), versionId),
    ]);
    await finishRun(false, error.slice(0, 500));
    return { ok: false, conflict, error, versionId };
  };

  await db
    .prepare(
      `INSERT INTO sched_versions (id, channel_id, number, status, effective_from_ms, horizon_ms, kind, actor, based_on_version_id,
         rollback_of_version_id, summary, item_count, created_at_ms, anchor_ms, action)
       VALUES (?,?,0,'building',?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(versionId, req.channelId, req.effectiveFrom, horizon, req.kind, req.actor, req.basedOn?.id ?? null, req.rollbackOf ?? null,
      req.summary.slice(0, 300), items.length, now, req.anchorMs ?? null, req.action ?? null)
    .run();

  try {
    // Insert in chunks.
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < items.length; i += ROWS_PER_INSERT) {
      const chunk = items.slice(i, i + ROWS_PER_INSERT);
      const placeholders = chunk.map(() => `(${ITEM_COLUMNS.map(() => "?").join(",")})`).join(",");
      statements.push(
        db.prepare(`INSERT INTO sched_log_items (${ITEM_COLUMNS.join(",")}) VALUES ${placeholders}`).bind(...chunk.flatMap((it) => itemValues(versionId, it)))
      );
    }
    for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH));

    // Validate what D1 actually holds.
    const problem = req.forceInvalid ?? (await validateStored(db, versionId, items.length, req.effectiveFrom, horizon));
    if (problem) return await fail(problem);

    const next = req.expectedMax + 1;
    const swapStmt = db
      .prepare(
        `UPDATE sched_versions SET status = 'published', number = ?, published_at_ms = ?
         WHERE id = ? AND status = 'building'
           AND COALESCE((SELECT MAX(number) FROM sched_versions WHERE channel_id = ? AND status = 'published'), 0) = ?`
      )
      .bind(next, Date.now(), versionId, req.channelId, req.expectedMax);
    const extra = req.alongside?.(versionId) ?? [];
    const swap = await (extra.length ? db.batch([swapStmt, ...extra]).then((r) => r[0]) : swapStmt.run())
      .catch(() => null); // the unique index refusing a duplicate number is a lost race too
    if (!swap || swap.meta.changes !== 1) return await fail("Someone else published first", true);

    await finishRun(true, null);
    if (req.changes?.length) await writeChanges(db, req.channelId, versionId, req.actor, req.changes, items, now);
    const version = await db.prepare("SELECT * FROM sched_versions WHERE id = ?").bind(versionId).first<VersionRow>();
    return { ok: true, version: version! };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

async function validateStored(db: D1Database, versionId: string, expected: number, from: number, horizon: number): Promise<string | null> {
  const { results } = await db
    .prepare(
      `SELECT starts_at_ms, ends_at_ms, offset_ms, audio_url, file_duration_ms, track_id, audio_asset_id, label
       FROM sched_log_items WHERE version_id = ? ORDER BY starts_at_ms, id`
    )
    .bind(versionId)
    .all<{ starts_at_ms: number; ends_at_ms: number; offset_ms: number; audio_url: string; file_duration_ms: number; track_id: string | null; audio_asset_id: string | null; label: string | null }>();
  if (results.length !== expected) return `Expected ${expected} items, found ${results.length}`;
  if (results.length === 0) return "The version has no items";
  if (results[0].starts_at_ms !== from) return "The first item doesn't start when the version takes effect";
  if (results[results.length - 1].ends_at_ms < horizon) return "The log ends before its horizon";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (i > 0 && r.starts_at_ms !== results[i - 1].ends_at_ms) return `Gap or overlap before "${r.label ?? "an item"}"`;
    if (!r.audio_url) return `"${r.label ?? "An item"}" has no audio`;
    if (!(r.file_duration_ms > 0)) return `"${r.label ?? "An item"}" has no length`;
    if (r.ends_at_ms <= r.starts_at_ms) return `"${r.label ?? "An item"}" has no air time`;
    if (r.ends_at_ms - r.starts_at_ms > r.file_duration_ms - r.offset_ms) return `"${r.label ?? "An item"}" is scheduled longer than its file`;
  }
  // Everything referenced must still exist and be published.
  const trackIds = [...new Set(results.map((r) => r.track_id).filter((x): x is string => !!x))];
  const assetIds = [...new Set(results.map((r) => r.audio_asset_id).filter((x): x is string => !!x))];
  for (const [table, ids] of [["tracks", trackIds], ["audio_assets", assetIds]] as const) {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const ok = await db
        // Audio items may be 'ready' as well: imported podcast episodes are, and published programmes have always played them.
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE status IN (${table === "tracks" ? "'published'" : "'published','ready'"}) AND id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .first<{ n: number }>();
      if ((ok?.n ?? 0) !== chunk.length) return table === "tracks" ? "A scheduled song is no longer published" : "A scheduled audio item is no longer published";
    }
  }
  return null;
}

async function writeChanges(db: D1Database, channelId: string, versionId: string, actor: string, changes: PendingChange[], items: PlanItem[], now: number) {
  const stmts = changes.map((c) => {
    // Resolve a planned item to the airing ID it got.
    let airing = c.airingId ?? null;
    if (!airing && c.item) {
      const want = c.item;
      // Planned items are copied while fitting, so match on content and time (an override not yet placed: on content and source).
      const match =
        items.find((i) => i === want) ??
        items.find((i) => contentKey(i) === contentKey(want) && (want.startsAt ? i.startsAt === want.startsAt : i.source === want.source && i.startsAt >= items[0].startsAt));
      airing = match?.airingId ?? c.item.airingId ?? null;
    }
    return db
      .prepare(
        `INSERT INTO sched_changes (channel_id, version_id, at_ms, actor, action, airing_id, before_json, after_json, reason)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(channelId, versionId, now, actor, c.action, airing, c.before ? JSON.stringify(c.before) : null, c.after ? JSON.stringify(c.after) : null, c.reason);
  });
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

export async function logChange(
  db: D1Database,
  c: { channelId: string; versionId?: string | null; actor: string; action: string; airingId?: string | null; before?: unknown; after?: unknown; reason: string }
) {
  await db
    .prepare(
      `INSERT INTO sched_changes (channel_id, version_id, at_ms, actor, action, airing_id, before_json, after_json, reason)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(c.channelId, c.versionId ?? null, Date.now(), c.actor, c.action, c.airingId ?? null,
      c.before ? JSON.stringify(c.before) : null, c.after ? JSON.stringify(c.after) : null, c.reason)
    .run();
}
