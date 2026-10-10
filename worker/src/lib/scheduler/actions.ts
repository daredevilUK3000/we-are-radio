import type { AudioAsset, Channel, Env, Track } from "../types";
import { recordAired, endAiring } from "./aired";
import { fitToWindow } from "./fit";
import { buildFromPlan, latestVersion, HORIZON_MS } from "./generate";
import { loadGridBlocks, occurrencesBetween } from "./grid";
import { Planner } from "./plan";
import { fallbackLoop } from "./read";
import { liveMax, publishVersion, rowToItem, type LogItemRow, type PendingChange, type VersionKind, type VersionRow } from "./store";
import { clearTimelineCache, itemsBetween, type TimelineItem } from "./timeline";
import { HOUR, MINUTE, mmss, parisHHMM, stationDate } from "./time";
import { contentKey, isDroppable, TOLERANCE_MS, type PlanItem, type Playable } from "./types";

/**
 * Live controls (Release 1). Each one is a single Studio request that builds,
 * validates and publishes a new version through publishVersion, writes the
 * change log, and returns. The rule: they interrupt, but they recover - the
 * next anchor (a grid block start, or else the next top of the hour at least
 * 10 minutes away) still starts on time.
 */

export type ActionName =
  | "play_now"
  | "skip"
  | "insert_next"
  | "replace"
  | "insert_jingle"
  | "record_link"
  | "back_on_schedule"
  | "rollback"
  | "remove";

export interface ActionRequest {
  action: ActionName;
  expected_version: number;
  item?: ItemRef;
  /** insert_next: several items, inserted in this order as the head (a voice note, then the song dedicated in it). */
  items?: ItemRef[];
  airing_id?: string;
  /** rollback only */
  number?: number;
  /** Who asked: Patrick in the Studio (default), or the system (the voice-note placer in the cron). */
  actor?: "studio" | "system";
  /** For actor 'system': the sentence the change log shows, e.g. "Listener voice note from Sarah (approved by you)". */
  reason?: string;
  /** The version's one-line summary, when the default ("Insert next: ...") isn't the right words. */
  summary?: string;
}

export type ItemRef = { track_id?: string | null; audio_asset_id?: string | null };

export type ActionResult =
  | { ok: true; version: VersionRow; message: string }
  | { ok: false; status: 400 | 404 | 409 | 503; error: string; message: string };

const VERB: Record<ActionName, string> = {
  play_now: "Play now",
  skip: "Skip",
  insert_next: "Insert next",
  replace: "Replace",
  insert_jingle: "Insert jingle",
  record_link: "Record a link",
  back_on_schedule: "Back on schedule",
  rollback: "Roll back",
  remove: "Remove",
};

const snapshot = (i: PlanItem | null | undefined) => (i ? { label: i.label, track_id: i.trackId, audio_asset_id: i.assetId } : null);

/** A track or asset from the library as something to put on air. */
export async function playableFor(db: D1Database, ref: ItemRef | undefined, reason: string): Promise<Playable | null> {
  if (ref?.track_id) {
    const t = await db.prepare("SELECT * FROM tracks WHERE id = ? AND status = 'published'").bind(ref.track_id).first<Track>();
    if (!t?.audio_url || !(t.duration_seconds > 0)) return null;
    return {
      itemType: "song", trackId: t.id, assetId: null, label: t.title, audioUrl: t.audio_url, artworkUrl: t.artwork_url,
      fileMs: t.duration_seconds * 1000, blockId: null, blockDate: null, source: "override", sourceRef: null, reasons: [reason],
    };
  }
  if (ref?.audio_asset_id) {
    const a = await db.prepare("SELECT * FROM audio_assets WHERE id = ? AND status IN ('published','ready')").bind(ref.audio_asset_id).first<AudioAsset>();
    if (!a?.audio_url || !(a.duration_seconds > 0)) return null;
    return {
      itemType: a.type === "jingle" || a.type === "promo" ? "station_id" : a.type,
      trackId: null, assetId: a.id, label: a.title, audioUrl: a.audio_url, artworkUrl: null,
      fileMs: a.duration_seconds * 1000, blockId: null, blockDate: null, source: "override", sourceRef: null, reasons: [reason],
    };
  }
  return null;
}

/** The recovery anchor after `from`: a block start 10-60 min away, else the next top of the hour at least 10 min away. */
export function anchorTarget(blockStarts: number[], from: number, hoursLater = 0): number {
  const soonest = from + 10 * MINUTE;
  const block = blockStarts.find((s) => s >= soonest && s <= from + 60 * MINUTE);
  if (block && !hoursLater) return block;
  let top = Math.ceil(soonest / HOUR) * HOUR;
  top += hoursLater * HOUR;
  return top;
}

export async function runAction(env: Env, channel: Channel, req: ActionRequest, nowMs = Date.now(), recordingAsset?: Playable): Promise<ActionResult> {
  const db = env.DB;
  const live = await liveMax(db, channel.id);
  if (!live) return { ok: false, status: 409, error: "no_log", message: "This channel has no log yet." };
  if (req.expected_version !== live) {
    return { ok: false, status: 409, error: "schedule_changed", message: "The schedule just changed. Here's the latest." };
  }
  const basedOn = (await latestVersion(db, channel.id))!;
  const horizon = basedOn.horizon_ms;
  const timeline = await itemsBetween(db, channel.id, nowMs - 3 * HOUR, horizon + 1);
  const curIdx = timeline.findIndex((i) => i.startsAt <= nowMs && nowMs < Math.min(i.endsAt, i.cutAt ?? Infinity));
  const cur = curIdx >= 0 ? timeline[curIdx] : null;
  const at = parisHHMM(nowMs);
  const verb = VERB[req.action];
  const actor = req.actor ?? "studio";
  // What the change log says about who did it.
  const byWhom = (what: string) => (actor === "system" && req.reason ? req.reason : `${what} by you at ${at}`);

  // Rebuild from the plan / copy an old version: no recovery arithmetic needed.
  if (req.action === "back_on_schedule") {
    const from = cur ? Math.min(cur.endsAt, cur.cutAt ?? Infinity) : nowMs;
    const out = await buildFromPlan(env, channel, {
      kind: "back_on_schedule", actor: "studio", from, to: Math.max(horizon, nowMs + HORIZON_MS), nowMs, action: "back_on_schedule",
      summary: () => `Back on schedule from ${parisHHMM(from)}`,
    });
    if (out.status !== "published") return { ok: false, status: 503, error: "build_failed", message: out.status === "failed" ? out.error : "Nothing to schedule." };
    await after(env, channel, out.version, nowMs, [{ action: "back_on_schedule", reason: `Back on schedule from ${parisHHMM(from)}: overrides dropped` }]);
    return { ok: true, version: out.version, message: `Back on schedule from ${parisHHMM(from)}, as v${out.version.number}.` };
  }

  const blocks = await loadGridBlocks(db, channel.id);
  const blockStarts = occurrencesBetween(blocks, nowMs, nowMs + 3 * HOUR).map((o) => o.startMs);
  const planner = new Planner(db, env.CONFIG, channel, blocks, nowMs);

  let S: number;
  let head: PlanItem[] = [];
  let rest: TimelineItem[]; // base items after the change point, in order
  const changes: PendingChange[] = [];
  let endCurrent: "skipped" | "interrupted" | null = null;
  let kind: VersionKind = req.action === "remove" ? "skip" : req.action;
  let summary = "";
  let sourceItems: TimelineItem[] = timeline;
  let rollbackOf: string | null = null;

  const override = async (reason: string, ref: ItemRef | undefined = req.item) => {
    const p = recordingAsset ?? (await playableFor(db, ref, reason));
    if (!p) return null;
    const inheritBlock = cur ?? timeline.find((i) => i.startsAt >= nowMs);
    return { ...p, reasons: [reason], blockId: inheritBlock?.blockId ?? null, blockDate: inheritBlock?.blockDate ?? null, startsAt: 0, endsAt: 0, offset: 0 } as PlanItem;
  };

  switch (req.action) {
    case "play_now":
    case "skip": {
      if (!cur) return { ok: false, status: 409, error: "nothing_on_air", message: "Nothing is on air right now." };
      S = nowMs;
      endCurrent = req.action === "skip" ? "skipped" : "interrupted";
      rest = timeline.slice(curIdx + 1);
      if (req.action === "play_now") {
        const o = await override(`Inserted by you at ${at} (Play now)`);
        if (!o) return { ok: false, status: 400, error: "bad_item", message: "That item can't be played." };
        head = [o];
        summary = `Play now: ${o.label ?? "an item"}`;
        changes.push({ action: "play_now", item: o, before: snapshot(cur), after: snapshot(o), reason: `Played now by you at ${at}` });
      } else {
        summary = `Skip: ${cur.label ?? "an item"}`;
        changes.push({ action: "skip", airingId: cur.airingId, before: snapshot(cur), reason: `Skipped by you at ${at}` });
      }
      break;
    }
    case "insert_next":
    case "insert_jingle":
    case "record_link": {
      S = cur ? Math.min(cur.endsAt, cur.cutAt ?? Infinity) : nowMs;
      rest = timeline.filter((i) => i.startsAt >= S);
      const refs = req.action === "insert_next" && req.items?.length ? req.items : [req.item];
      for (const ref of refs) {
        const o = await override(actor === "system" && req.reason ? req.reason : `Inserted by you at ${at} (${verb})`, ref);
        if (!o) return { ok: false, status: 400, error: "bad_item", message: "That item can't be played." };
        head.push(o);
        changes.push({ action: req.action, item: o, after: snapshot(o), reason: byWhom("Inserted next") });
      }
      summary = req.summary ?? `${verb}: ${head.map((o) => o.label ?? "an item").join(", then ")}`;
      break;
    }
    case "remove": {
      // One upcoming airing that hasn't started goes; recovery fills its time so the next anchor keeps its start.
      const target = timeline.find((i) => i.airingId === req.airing_id && i.startsAt > nowMs);
      if (!target) return { ok: false, status: 404, error: "not_found", message: "That item isn't coming up any more." };
      S = target.startsAt;
      rest = timeline.filter((i) => i.startsAt > target.startsAt);
      kind = "skip";
      summary = `Removed: ${target.label ?? "an item"}`;
      changes.push({ action: "skip", airingId: target.airingId, before: snapshot(target), reason: byWhom("Removed") });
      break;
    }
    case "replace": {
      const target = timeline.find((i) => i.airingId === req.airing_id && i.startsAt > nowMs);
      if (!target) return { ok: false, status: 404, error: "not_found", message: "That item isn't coming up any more." };
      S = target.startsAt;
      rest = timeline.filter((i) => i.startsAt > target.startsAt);
      const o = await override(`Replaced by you at ${at} (was ${target.label ?? "an item"})`);
      if (!o) return { ok: false, status: 400, error: "bad_item", message: "That item can't be played." };
      head = [o];
      summary = `Replace: ${target.label ?? "an item"} with ${o.label ?? "an item"}`;
      changes.push({ action: "replace", item: o, before: snapshot(target), after: snapshot(o), reason: `Replaced by you at ${at}` });
      changes.push({ action: "replace", airingId: target.airingId, before: snapshot(target), after: snapshot(o), reason: `Replaced by ${o.label ?? "another item"} (by you at ${at})` });
      break;
    }
    case "rollback": {
      const target = await db
        .prepare("SELECT * FROM sched_versions WHERE channel_id = ? AND status = 'published' AND number = ?")
        .bind(channel.id, req.number ?? -1)
        .first<VersionRow>();
      if (!target) return { ok: false, status: 404, error: "not_found", message: "That version doesn't exist any more." };
      S = cur ? Math.min(cur.endsAt, cur.cutAt ?? Infinity) : nowMs;
      const { results } = await db
        .prepare("SELECT * FROM sched_log_items WHERE version_id = ? AND ends_at_ms > ? ORDER BY starts_at_ms")
        .bind(target.id, S)
        .all<LogItemRow>();
      rest = results.map((r) => ({ ...rowToItem(r), versionId: target.id, versionNumber: target.number })).filter((i) => i.startsAt >= S);
      if (rest.length === 0) return { ok: false, status: 409, error: "too_old", message: `v${target.number} doesn't cover the time from ${parisHHMM(S)} on.` };
      sourceItems = rest;
      kind = "rollback";
      rollbackOf = target.id;
      summary = `Rolled back to v${target.number}`;
      changes.push({ action: "rollback", reason: `Rolled back to v${target.number} by you at ${at}` });
      break;
    }
    default:
      return { ok: false, status: 400, error: "bad_action", message: "Unknown action." };
  }

  // ---- recovery: fit [S, anchor) so the anchor keeps its time; copy everything after it.
  const windowBlock = (rest[0] ?? cur)?.blockId ? (rest[0] ?? cur)! : null;
  const pool = await recoveryPool(env, channel, planner, windowBlock, nowMs);
  const recent = await recentlyAired(db, channel.id, nowMs);
  for (const i of timeline) if (i.startsAt <= S && i.startsAt >= S - 2 * HOUR) recent.set(contentKey(i), i.startsAt);

  let result: { items: PlanItem[]; anchor: number; changes: ReturnType<typeof fitToWindow>["changes"] } | null = null;
  for (let tries = 0; tries < 2 && !result; tries++) {
    const target = anchorTarget(blockStarts, S, tries);
    // The anchor is the first base item starting at or after the target time: its start is what's kept.
    const anchorItem = rest.find((i) => i.startsAt >= target);
    const anchor = anchorItem ? anchorItem.startsAt : horizonOf(rest, horizon);
    const windowItems = rest.filter((i) => i.startsAt < anchor);
    const reasonAnchor = parisHHMM(anchor);
    const fitted = fitToWindow([...head, ...windowItems], S, anchor, pool, recent, {
      dropped: `Dropped to keep ${reasonAnchor} on time after ${verb}`,
      added: (gap) => `Added to fill ${mmss(gap)} after ${verb}`,
      trimmed: (ms) => `Faded ${mmss(ms)} early to start ${reasonAnchor} on time`,
    });
    const trimmed = fitted.changes.find((c) => c.kind === "trimmed");
    if (tries === 0 && trimmed && trimmed.amountMs > TOLERANCE_MS && anchorItem) continue; // try the following hour once
    result = { items: fitted.items, anchor, changes: fitted.changes };
  }
  if (!result) return { ok: false, status: 503, error: "no_fit", message: "Couldn't fit the change." };

  const tail = (kind === "rollback" ? sourceItems : rest).filter((i) => i.startsAt >= result!.anchor);
  const items: PlanItem[] = [...result.items, ...tail.map(({ versionId: _v, versionNumber: _n, cutAt: _c, ...i }) => i as PlanItem)];
  for (const c of result.changes) {
    changes.push({
      action: req.action,
      item: c.kind === "added" ? c.item : undefined,
      airingId: c.kind === "added" ? undefined : c.item.airingId ?? null,
      before: c.kind === "dropped" ? snapshot(c.item) : undefined,
      after: c.kind === "added" ? snapshot(c.item) : undefined,
      reason: c.item.reasons[c.item.reasons.length - 1] ?? c.kind,
    });
  }

  const published = await publishVersion(db, {
    channelId: channel.id,
    kind,
    actor,
    summary,
    effectiveFrom: S,
    items,
    basedOn,
    baseItems: timeline.filter((i) => i.endsAt > S),
    expectedMax: live,
    rollbackOf,
    anchorMs: result.anchor,
    changes,
    action: req.action,
    nowMs,
  });
  if (!published.ok) {
    return published.conflict
      ? { ok: false, status: 409, error: "schedule_changed", message: "The schedule just changed. Here's the latest." }
      : { ok: false, status: 503, error: "build_failed", message: published.error };
  }
  if (endCurrent && cur) await endAiring(db, channel.id, cur.airingId!, nowMs, endCurrent);
  await after(env, channel, published.version, nowMs, []);
  return { ok: true, version: published.version, message: `${summary}. Live as v${published.version.number}.` };
}

function horizonOf(items: PlanItem[], fallback: number) {
  return items.length ? items[items.length - 1].endsAt : fallback;
}

async function after(env: Env, channel: Channel, version: VersionRow, nowMs: number, extra: PendingChange[]) {
  clearTimelineCache(channel.id);
  for (const c of extra) {
    await env.DB.prepare(
      `INSERT INTO sched_changes (channel_id, version_id, at_ms, actor, action, airing_id, before_json, after_json, reason)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
      .bind(channel.id, version.id, nowMs, "studio", c.action, c.airingId ?? null, null, null, c.reason)
      .run();
  }
  await recordAired(env.DB, channel.id, nowMs).catch(() => {});
}

/** Songs aired on the channel in the last two hours (content key -> start). */
export async function recentlyAired(db: D1Database, channelId: string, nowMs: number): Promise<Map<string, number>> {
  const { results } = await db
    .prepare("SELECT track_id, audio_asset_id, starts_at_ms FROM sched_aired WHERE channel_id = ? AND starts_at_ms > ?")
    .bind(channelId, nowMs - 2 * HOUR)
    .all<{ track_id: string | null; audio_asset_id: string | null; starts_at_ms: number }>();
  const m = new Map<string, number>();
  for (const r of results) m.set(contentKey({ trackId: r.track_id, assetId: r.audio_asset_id }), r.starts_at_ms);
  return m;
}

/** What a gap can be filled with: the block's own pool, or the channel default's songs, then the emergency playlist. */
export async function recoveryPool(env: Env, channel: Channel, planner: Planner, inBlock: PlanItem | null, nowMs: number): Promise<Playable[]> {
  let pool: Playable[] = [];
  if (inBlock?.blockId && inBlock.blockDate) {
    const occ = occurrencesBetween(planner.blocks, nowMs - 26 * HOUR, nowMs + 26 * HOUR).find((o) => o.block.id === inBlock.blockId && o.date === inBlock.blockDate);
    if (occ) pool = (await planner.contentFor(occ).catch(() => null))?.pool ?? [];
  }
  if (pool.length === 0) pool = await planner.defaultPool(stationDate(nowMs));
  const fb = await fallbackLoop(env.DB, channel.id);
  const extra: Playable[] = (fb?.items ?? [])
    .filter((i) => i.item_type === "song" && i.audio_url)
    .map((i) => ({
      itemType: "song", trackId: i.track_id, assetId: null, label: i.label, audioUrl: i.audio_url!, artworkUrl: i.artwork_url,
      fileMs: i.duration_seconds * 1000, blockId: inBlock?.blockId ?? null, blockDate: inBlock?.blockDate ?? null,
      source: "fallback", sourceRef: null, reasons: ["From the emergency playlist"],
    }));
  return [...pool.map((p) => ({ ...p, blockId: inBlock?.blockId ?? p.blockId, blockDate: inBlock?.blockDate ?? p.blockDate })), ...extra];
}

export { isDroppable };
