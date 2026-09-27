import { rowToItem, type LogItemRow, type VersionRow } from "./store";
import type { PlanItem } from "./types";

/**
 * Reading the log. For any instant t, the governing version is the
 * published version with the highest number whose effective_from_ms <= t.
 * These run on every now-playing request, so each is a couple of indexed
 * queries, and the resolved list is cached per Worker instance for 5 s,
 * keyed on the channel and its live version number.
 */

export interface TimelineItem extends PlanItem {
  versionId: string;
  versionNumber: number;
  /** Where this version's governance of the item stops (a later version took over), if before the item's end. */
  cutAt?: number;
}

export async function governingVersion(db: D1Database, channelId: string, tMs: number): Promise<VersionRow | null> {
  return db
    .prepare(
      `SELECT * FROM sched_versions
       WHERE channel_id = ? AND status = 'published' AND effective_from_ms <= ?
       ORDER BY number DESC LIMIT 1`
    )
    .bind(channelId, tMs)
    .first<VersionRow>();
}

/** The governing version for each stretch of [fromMs, toMs). */
export async function governingSegments(
  db: D1Database,
  channelId: string,
  fromMs: number,
  toMs: number
): Promise<{ version: VersionRow; from: number; to: number }[]> {
  const first = await governingVersion(db, channelId, fromMs);
  const { results: later } = await db
    .prepare(
      `SELECT * FROM sched_versions
       WHERE channel_id = ? AND status = 'published' AND effective_from_ms > ? AND effective_from_ms < ? AND number > ?
       ORDER BY effective_from_ms, number`
    )
    .bind(channelId, fromMs, toMs, first?.number ?? 0)
    .all<VersionRow>();
  const segs: { version: VersionRow; from: number; to: number }[] = [];
  let current = first;
  let start = fromMs;
  for (const v of later) {
    if (current && v.number < current.number) continue;
    if (current && v.effective_from_ms > start) segs.push({ version: current, from: start, to: v.effective_from_ms });
    current = v;
    start = Math.max(start, v.effective_from_ms);
  }
  if (current) segs.push({ version: current, from: start, to: toMs });
  return segs;
}

/** One contiguous list: each version's items only inside the stretch it governs. */
export async function itemsBetween(db: D1Database, channelId: string, fromMs: number, toMs: number): Promise<TimelineItem[]> {
  const segs = await governingSegments(db, channelId, fromMs, toMs);
  const out: TimelineItem[] = [];
  for (const seg of segs) {
    const { results } = await db
      .prepare(
        `SELECT * FROM sched_log_items WHERE version_id = ? AND starts_at_ms < ? AND ends_at_ms > ?
         ORDER BY starts_at_ms`
      )
      .bind(seg.version.id, seg.to, seg.from)
      .all<LogItemRow>();
    for (const r of results) {
      const item: TimelineItem = { ...rowToItem(r), versionId: seg.version.id, versionNumber: seg.version.number };
      if (item.endsAt > seg.to && seg.to < toMs) item.cutAt = seg.to;
      // An item a later version starts part-way through is shown from where it governs.
      if (item.startsAt < seg.from && out.length && out[out.length - 1].airingId === item.airingId) continue;
      out.push(item);
    }
  }
  return out;
}

/** The item on air at t and how far into it (ms from its scheduled start), or null when the log doesn't cover t. */
export async function itemAt(db: D1Database, channelId: string, tMs: number): Promise<{ item: TimelineItem; version: VersionRow } | null> {
  const version = await governingVersion(db, channelId, tMs);
  if (!version) return null;
  const r = await db
    .prepare(
      `SELECT * FROM sched_log_items WHERE version_id = ? AND starts_at_ms <= ? AND ends_at_ms > ?
       ORDER BY starts_at_ms DESC LIMIT 1`
    )
    .bind(version.id, tMs, tMs)
    .first<LogItemRow>();
  if (!r) return null;
  return { item: { ...rowToItem(r), versionId: version.id, versionNumber: version.number }, version };
}

// ------------------------------------------------------------------ cache

interface CacheEntry {
  at: number;
  version: number;
  from: number;
  to: number;
  items: TimelineItem[];
}
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 5_000;

/**
 * The next couple of hours of a channel's log, cached for 5 s per Worker
 * instance and keyed on the live version number (which the caller reads in
 * the same query as the channel's Scheduler state).
 */
export async function cachedWindow(db: D1Database, channelId: string, liveVersion: number, nowMs: number, minutes = 125): Promise<TimelineItem[]> {
  const hit = cache.get(channelId);
  const to = nowMs + minutes * 60_000;
  if (hit && hit.version === liveVersion && nowMs - hit.at < CACHE_MS && hit.from <= nowMs && hit.to >= to) return hit.items;
  const from = nowMs - 30 * 60_000;
  const items = await itemsBetween(db, channelId, from, to);
  cache.set(channelId, { at: nowMs, version: liveVersion, from, to, items });
  return items;
}

export function clearTimelineCache(channelId?: string) {
  if (channelId) cache.delete(channelId);
  else cache.clear();
}

export function locate(items: TimelineItem[], tMs: number): number {
  return items.findIndex((i) => i.startsAt <= tMs && tMs < Math.min(i.endsAt, i.cutAt ?? Infinity));
}
