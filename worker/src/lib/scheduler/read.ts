import type { Channel, Env, Programme } from "../types";
import type { RotationItem } from "../radioBrain";
import { locateInLoop } from "../radioBrain";
import { enrichItems } from "../station";
import { cachedWindow, itemsBetween, locate, type TimelineItem } from "./timeline";
import { loadGridBlocks } from "./grid";
import { voiceFor } from "../onAir";

/**
 * /api/now-playing and /api/schedule for a channel the Scheduler drives
 * (sched_channels.enabled = 1). The response shape is exactly the old one,
 * plus a few fields. Never throws: the caller falls back to the old path
 * when this returns null.
 *
 * Fallback chain: the log -> the channel's emergency playlist (looped from
 * the epoch, like autopilot) -> null (the old loadStation path).
 *
 * Item fields, as before: `id` (now the airing ID, stable across versions),
 * `duration_seconds` and `position_seconds`. New: `file_duration_seconds`,
 * `starts_at` / `ends_at` (Unix seconds) and `log_version`. `position_seconds`
 * and `duration_seconds` are positions in the file: an airing that ends early
 * (a fade before a hard start) has duration_seconds < file_duration_seconds,
 * and one that joined a file part-way (as the pre-Scheduler loop sometimes
 * did at midnight) has starts_at before it went on air.
 */

export interface SchedState {
  enabled: number;
  live: number;
  on_fallback_since_ms: number | null;
}

export async function schedState(db: D1Database, channelId: string): Promise<SchedState | null> {
  return db
    .prepare(
      `SELECT enabled, on_fallback_since_ms,
              (SELECT COALESCE(MAX(number), 0) FROM sched_versions WHERE channel_id = ?1 AND status = 'published') AS live
       FROM sched_channels WHERE channel_id = ?1`
    )
    .bind(channelId)
    .first<SchedState>();
}

// Programme and block rows for the `programme` field, cached per instance for a minute.
const rowCache = new Map<string, { at: number; row: unknown }>();
async function cachedRow<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = rowCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.row as T | null;
  const row = await load();
  rowCache.set(key, { at: Date.now(), row });
  return row;
}

async function programmeFor(db: D1Database, channel: Channel, item: TimelineItem) {
  if (item.blockId) {
    const block = await cachedRow(`blk:${channel.id}:${item.blockId}`, async () =>
      (await loadGridBlocks(db, channel.id, true)).find((b) => b.id === item.blockId) ?? null
    );
    if (block) return { id: null, title: block.name, description: block.description };
  }
  if (item.source === "programme" && item.sourceRef) {
    const p = await cachedRow(`prg:${item.sourceRef}`, () =>
      db.prepare("SELECT * FROM programmes WHERE id = ?").bind(item.sourceRef).first<Programme>()
    );
    if (p) return p;
  }
  return { id: null, title: channel.name, description: channel.description };
}

const toRotation = (i: TimelineItem): RotationItem & Record<string, unknown> => ({
  id: i.airingId!,
  item_type: i.itemType,
  label: i.label,
  track_id: i.trackId,
  audio_asset_id: i.assetId,
  duration_seconds: (i.offset + (i.cutAt ? Math.min(i.endsAt, i.cutAt) : i.endsAt) - i.startsAt) / 1000,
  audio_url: i.audioUrl,
  artwork_url: i.artworkUrl,
  ...(i.overlays?.length ? { overlays: i.overlays } : {}),
  file_duration_seconds: i.fileMs / 1000,
  starts_at: Math.round((i.startsAt - i.offset) / 1000),
  ends_at: Math.round(i.endsAt / 1000),
});

export async function nowPlayingFromLog(env: Env, channel: Channel, st: SchedState, nowMs: number, waitUntil: (p: Promise<unknown>) => void) {
  try {
    const items = await cachedWindow(env.DB, channel.id, st.live, nowMs);
    const idx = locate(items, nowMs);
    if (idx >= 0) {
      if (st.on_fallback_since_ms) waitUntil(setFallback(env.DB, channel.id, null));
      const cur = items[idx];
      const next = items[idx + 1] ?? null;
      const comingUp = items.slice(idx + 1).filter((i) => i.itemType !== "station_id" && i.airingId !== cur.airingId).slice(0, 4);
      const [nowE, nextE, ...upE] = await enrichItems(env.DB, [toRotation(cur), next ? toRotation(next) : null, ...comingUp.map(toRotation)]);
      return {
        channel,
        programme: await programmeFor(env.DB, channel, cur),
        on_air: true,
        position_seconds: Math.floor((cur.offset + nowMs - cur.startsAt) / 1000),
        now_playing: await withVoice(env.DB, nowE),
        up_next: nextE,
        coming_up: upE,
        log_version: cur.versionNumber,
      };
    }
  } catch (err) {
    console.error("scheduler read failed", channel.slug, err);
  }
  // The log doesn't cover now: the emergency playlist.
  const fb = await fallbackNowPlaying(env.DB, channel, nowMs).catch(() => null);
  if (fb) {
    if (!st.on_fallback_since_ms) waitUntil(setFallback(env.DB, channel.id, nowMs));
    return fb;
  }
  return null;
}

export async function scheduleFromLog(env: Env, channel: Channel, st: SchedState, nowMs: number, minutes: number) {
  try {
    const items =
      minutes <= 120 ? await cachedWindow(env.DB, channel.id, st.live, nowMs) : await itemsBetween(env.DB, channel.id, nowMs - 30 * 60_000, nowMs + minutes * 60_000);
    const idx = locate(items, nowMs);
    if (idx >= 0) {
      const horizon = nowMs + minutes * 60_000;
      const picked = items.slice(idx).filter((i) => i.startsAt < horizon);
      const enriched = await enrichItems(env.DB, picked.map(toRotation));
      const cur = items[idx];
      return {
        channel,
        programme: await programmeFor(env.DB, channel, cur),
        on_air: true,
        position_seconds: Math.floor((cur.offset + nowMs - cur.startsAt) / 1000),
        log_version: cur.versionNumber,
        // Overlay jingles are played by the listener's browser over a song; a queue can't, so they're left out.
        items: await Promise.all(enriched.map((e) => withVoice(env.DB, { ...e, overlays: undefined }))),
      };
    }
  } catch (err) {
    console.error("scheduler schedule read failed", channel.slug, err);
  }
  const loop = await fallbackLoop(env.DB, channel.id).catch(() => null);
  if (!loop) return null;
  const { currentIndex, position_seconds } = locateInLoop(loop.items, Math.floor((nowMs / 1000) % loop.total));
  const nowSec = Math.floor(nowMs / 1000);
  let startsAt = nowSec - position_seconds;
  const out: (RotationItem & { starts_at: number })[] = [];
  for (let step = 0; startsAt < nowSec + minutes * 60 && step < 1000; step++) {
    const item = loop.items[(currentIndex + step) % loop.items.length];
    out.push({ ...item, id: `fb-${item.id}-${startsAt}`, starts_at: startsAt });
    startsAt += item.duration_seconds;
  }
  return { channel, programme: { id: null, title: channel.name, description: channel.description }, on_air: true, fallback: true, position_seconds, items: await enrichItems(env.DB, out) };
}

/**
 * A listener's voice note on air carries `voice` (first name, place, kind, who
 * it's for) for the players' "Listener voice" badge and the Chromecast's
 * metadata. Nothing else about the message is ever added.
 */
async function withVoice<T extends Record<string, any> | null>(db: D1Database, item: T): Promise<T> {
  if (!item || item.item_type !== "link" || !item.audio_asset_id) return item;
  const voice = await voiceFor(db, item.audio_asset_id);
  return voice ? { ...item, voice } : item;
}

async function setFallback(db: D1Database, channelId: string, since: number | null) {
  await db.prepare("UPDATE sched_channels SET on_fallback_since_ms = ? WHERE channel_id = ?").bind(since, channelId).run();
}

// ------------------------------------------------------------ fallback

export async function fallbackLoop(db: D1Database, channelId: string): Promise<{ items: RotationItem[]; total: number } | null> {
  const { results } = await db
    .prepare(
      `SELECT f.position, f.track_id, f.audio_asset_id,
              t.title AS t_title, t.duration_seconds AS t_dur, t.audio_url AS t_url, t.artwork_url AS t_art, t.status AS t_status,
              a.title AS a_title, a.type AS a_type, a.duration_seconds AS a_dur, a.audio_url AS a_url, a.status AS a_status
       FROM sched_fallback_items f
       LEFT JOIN tracks t ON t.id = f.track_id
       LEFT JOIN audio_assets a ON a.id = f.audio_asset_id
       WHERE f.channel_id = ? ORDER BY f.position`
    )
    .bind(channelId)
    .all<Record<string, any>>();
  const items: RotationItem[] = results
    .filter((r) => (r.track_id ? r.t_status === "published" && r.t_url && r.t_dur > 0 : (r.a_status === "published" || r.a_status === "ready") && r.a_url && r.a_dur > 0))
    .map((r) => ({
      id: `${r.track_id ?? r.audio_asset_id}-${r.position}`,
      item_type: r.track_id ? "song" : r.a_type === "jingle" || r.a_type === "promo" ? "station_id" : r.a_type,
      label: r.track_id ? r.t_title : r.a_title,
      track_id: r.track_id,
      audio_asset_id: r.track_id ? null : r.audio_asset_id,
      duration_seconds: r.track_id ? r.t_dur : r.a_dur,
      audio_url: r.track_id ? r.t_url : r.a_url,
      artwork_url: r.track_id ? r.t_art : null,
    }));
  const total = items.reduce((s, i) => s + i.duration_seconds, 0);
  return items.length && total > 0 ? { items, total } : null;
}

async function fallbackNowPlaying(db: D1Database, channel: Channel, nowMs: number) {
  const loop = await fallbackLoop(db, channel.id);
  if (!loop) return null;
  const { currentIndex, position_seconds } = locateInLoop(loop.items, Math.floor((nowMs / 1000) % loop.total));
  const now = loop.items[currentIndex];
  const upNext = loop.items[(currentIndex + 1) % loop.items.length];
  const comingUp: RotationItem[] = [];
  for (let step = 1; step < loop.items.length && comingUp.length < 4; step++) {
    const item = loop.items[(currentIndex + step) % loop.items.length];
    if (item.item_type !== "station_id" && item.id !== now.id) comingUp.push(item);
  }
  const [nowE, nextE, ...upE] = await enrichItems(db, [now, upNext, ...comingUp]);
  return {
    channel,
    programme: { id: null, title: channel.name, description: channel.description },
    on_air: true,
    fallback: true,
    position_seconds,
    now_playing: nowE,
    up_next: nextE,
    coming_up: upE,
  };
}
