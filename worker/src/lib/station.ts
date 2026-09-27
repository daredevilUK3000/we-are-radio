import type { AudioAsset, Channel, Programme, Track } from "./types";
import { loadCapsulesFor, loadTodaysCapsules, stationToday, withCapsules, type CapsuleClip } from "./capsules";
import { buildRotation, hashSeed, withPinnedJingles, type PinnedJingle, type RotationItem } from "./radioBrain";

/**
 * A channel's loop: what /now-playing has always played, and what the
 * Scheduler's "channel default" reproduces. Moved here from routes/public.ts
 * unchanged, except that the capsule date is a parameter (the Scheduler
 * builds tomorrow's loop as well as today's) and the loop's anchor is
 * returned instead of the seconds elapsed since it.
 *
 * Loop k of a channel starts at anchorMs + k * loopMs:
 * - manual channels: the latest published programme, anchored on its publish_date;
 * - autopilot channels: the Radio Brain rotation, anchored on the Unix epoch.
 */

export type SyntheticProgramme = { id: null; title: string; description: string | null };

export interface StationLoop {
  items: RotationItem[];
  anchorMs: number;
  loopMs: number;
  programme: Programme | SyntheticProgramme;
  source: "programme" | "autopilot";
  /** programme id, or "rotation:<hash>" */
  sourceRef: string;
  /** Everything the loop was built from; changes whenever the loop would. */
  fingerprint: string;
}

export type LoopResult = StationLoop | { items: null; programme?: Programme; fingerprint: string };

interface ItemRow {
  id: string;
  position: number;
  item_type: string;
  track_id: string | null;
  audio_asset_id: string | null;
  label: string | null;
  track_title: string | null;
  track_duration_seconds: number | null;
  track_audio_url: string | null;
  track_artwork_url: string | null;
  audio_asset_title: string | null;
  audio_asset_duration_seconds: number | null;
  audio_asset_audio_url: string | null;
}

/**
 * @param capsules the capsules due on the loop's station day; omit to use
 *   today's (loadTodaysCapsules, which also retires past ones - what the old
 *   now-playing did on every request).
 */
export async function loadStationLoop(
  db: D1Database,
  kv: KVNamespace,
  channel: Channel,
  opts: { capsuleDate?: string; nowMs?: number } = {}
): Promise<LoopResult> {
  const capsules = opts.capsuleDate ? await loadCapsulesFor(db, opts.capsuleDate) : await loadTodaysCapsules(db);
  if (channel.programming_mode === "autopilot") return loadAutopilotLoop(db, kv, channel, capsules);
  return loadManualLoop(db, channel, capsules, opts.nowMs ?? Date.now());
}

/** The programme a manual channel plays: its flagship, else its latest published. */
export async function currentProgramme(db: D1Database, channelId: string): Promise<Programme | null> {
  return db
    .prepare(
      `SELECT * FROM programmes
       WHERE channel_id = ? AND status = 'published'
       ORDER BY is_flagship DESC, publish_date DESC
       LIMIT 1`
    )
    .bind(channelId)
    .first<Programme>();
}

/** A programme's running order as loop items (pinned jingles applied), before capsules. */
export async function programmeItems(db: D1Database, programmeId: string, pins?: PinnedJingle[]): Promise<RotationItem[]> {
  const { results: rows } = await db
    .prepare(
      `SELECT pi.*, t.title as track_title, t.duration_seconds as track_duration_seconds, t.audio_url as track_audio_url, t.artwork_url as track_artwork_url,
              aa.title as audio_asset_title, aa.duration_seconds as audio_asset_duration_seconds, aa.audio_url as audio_asset_audio_url
       FROM programme_items pi
       LEFT JOIN tracks t ON t.id = pi.track_id
       LEFT JOIN audio_assets aa ON aa.id = pi.audio_asset_id
       WHERE pi.programme_id = ?
       ORDER BY pi.position ASC`
    )
    .bind(programmeId)
    .all<ItemRow>();

  const baseItems: RotationItem[] = rows.map((row) => ({
    id: row.id,
    item_type: row.item_type,
    label: row.label ?? row.track_title ?? row.audio_asset_title,
    track_id: row.track_id,
    audio_asset_id: row.audio_asset_id,
    duration_seconds: row.track_duration_seconds ?? row.audio_asset_duration_seconds ?? 0,
    audio_url: row.track_audio_url ?? row.audio_asset_audio_url,
    artwork_url: row.track_artwork_url,
  }));
  // Pinned jingles play over their song here too, not just on autopilot channels.
  return withPinnedJingles(baseItems, pins ?? (await loadPinnedJingles(db)));
}

async function loadManualLoop(db: D1Database, channel: Channel, capsules: CapsuleClip[], nowMs: number): Promise<LoopResult> {
  const programme = await currentProgramme(db, channel.id);
  if (!programme || !programme.duration_seconds) return { items: null, fingerprint: `manual:${programme?.id ?? "none"}` };

  const pins = await loadPinnedJingles(db);
  const base = await programmeItems(db, programme.id, pins);
  const fingerprint = [
    "manual",
    programme.id,
    programme.updated_at,
    programme.publish_date,
    base.map((i) => `${i.id}:${i.duration_seconds}`).join(","),
    pinsConfig(pins),
    capsules.map((c) => c.id).join(","),
  ].join("|");
  if (base.length === 0) return { items: null, programme, fingerprint };

  // Time capsules due that day are dropped into the loop like station IDs.
  const items = withCapsules(base, capsules);
  const loopSeconds = items.reduce((sum, i) => sum + i.duration_seconds, 0) || programme.duration_seconds;
  const anchorMs = programme.publish_date ? new Date(programme.publish_date).getTime() : nowMs;
  return {
    items,
    anchorMs,
    loopMs: loopSeconds * 1000,
    programme,
    source: "programme",
    sourceRef: programme.id,
    fingerprint,
  };
}

/** Published tracks for an autopilot pool: matching any of the tags, or the whole catalogue. */
export async function autopilotTracks(db: D1Database, tagsAny: string[]): Promise<Track[]> {
  return tagsAny.length > 0
    ? (
        await db
          .prepare(
            `SELECT DISTINCT t.* FROM tracks t
             JOIN track_tags tt ON tt.track_id = t.id
             JOIN tags tg ON tg.id = tt.tag_id
             WHERE t.status = 'published' AND tg.name IN (${tagsAny.map(() => "?").join(",")})
             ORDER BY t.id ASC`
          )
          .bind(...tagsAny)
          .all<Track>()
      ).results
    : (await db.prepare("SELECT * FROM tracks WHERE status = 'published' ORDER BY id ASC").all<Track>()).results;
}

export async function stationIdAssets(db: D1Database): Promise<AudioAsset[]> {
  const { results } = await db
    .prepare("SELECT * FROM audio_assets WHERE status = 'published' AND type IN ('station_id','jingle','promo')")
    .all<AudioAsset>();
  return results;
}

export const channelTags = (channel: Channel): string[] => {
  const rules = channel.catalogue_rules ? JSON.parse(channel.catalogue_rules) : null;
  return rules?.tags_any ?? [];
};

const pinsConfig = (pins: PinnedJingle[]) =>
  pins
    .map((p) => `${p.track_id}>${p.asset_id}@${p.start_offset_seconds}:${p.duck_level}:${p.duck_fade_ms}`)
    .sort()
    .join(",");

async function loadAutopilotLoop(db: D1Database, kv: KVNamespace, channel: Channel, capsules: CapsuleClip[]): Promise<LoopResult> {
  const tracks = await autopilotTracks(db, channelTags(channel));
  const stationIds = await stationIdAssets(db);

  // The cache/seed key is fingerprinted on exactly which tracks and station
  // IDs currently qualify, not a timestamp - so the rotation is stable
  // between requests but regenerates itself the instant the pool changes.
  const fingerprint = [tracks.map((t) => t.id).sort().join(","), stationIds.map((a) => a.id).sort().join(",")].join("|");
  if (tracks.length === 0) return { items: null, fingerprint: `autopilot:empty` };

  const seedKey = `${channel.id}:${fingerprint}`;
  // KV keys are capped at 512 bytes - the raw fingerprint alone blows past
  // that once there are more than a handful of tracks/assets, so the cache
  // key is a hash of it instead. The PRNG seed (seedKey) can stay the full
  // string - that's just in-memory, no length limit there.
  //
  // How each jingle is played (sequenced vs ducked over a song) changes the
  // rotation's contents but must NOT change its shuffle order - a listener
  // mid-song shouldn't be teleported because Kizzi tuned a jingle - so it
  // goes in the cache key only, not in the seed.
  const playbackConfig = stationIds
    .map((a) => `${a.id}:${a.play_mode}:${a.duck_level}:${a.duck_fade_ms}`)
    .sort()
    .join(",");
  // Pinned jingles change the rotation's contents the same way, so they're part of the key too.
  const pins = await loadPinnedJingles(db);
  // The day's time capsules are part of the rotation, so which ones are due is part of the key too.
  const capsuleConfig = capsules.map((cp) => cp.id).join(",");
  const hash = hashSeed(fingerprint + "|" + playbackConfig + "|" + pinsConfig(pins) + "|" + capsuleConfig);
  const cacheKey = `radio-brain:${channel.id}:${hash}`;

  let items = await kv.get<RotationItem[]>(cacheKey, "json");
  if (!items) {
    items = withCapsules(buildRotation(seedKey, tracks, stationIds, pins), capsules);
    await kv.put(cacheKey, JSON.stringify(items), { expirationTtl: 60 * 60 * 24 * 30 });
  }

  const totalDuration = items.reduce((sum, i) => sum + i.duration_seconds, 0);
  const full = `autopilot|${hash}|${channel.catalogue_rules ?? ""}`;
  if (items.length === 0 || totalDuration === 0) return { items: null, fingerprint: full };

  return {
    items,
    anchorMs: 0,
    loopMs: totalDuration * 1000,
    programme: { id: null, title: channel.name, description: channel.description },
    source: "autopilot",
    sourceRef: `rotation:${hash}`,
    fingerprint: full,
  };
}

export type Station =
  | { items: RotationItem[]; elapsed: number; programme: Programme | SyntheticProgramme }
  | { items: null; programme?: Programme };

/**
 * Section 20: the station doesn't need a real 24/7 audio stream. Instead we
 * pick the current on-air content for a live channel and deterministically
 * compute *where in it* a listener joining right now would be, looping it
 * once it finishes. That's enough to make "Listen Now" feel live.
 *
 * 'manual' channels (Kizzi Radio) work exactly as before: the most recent
 * published programme, hand-built or AI-assisted-then-approved, looped
 * against its publish date.
 *
 * 'autopilot' channels (handoff_radio_brain_roadmap.md, Phase 1 - We Are
 * 50s and friends) have no programme at all. The Radio Brain
 * (lib/radioBrain.ts) builds a rotation from every published track
 * matching the channel's catalogue_rules (or, if it has none, the whole
 * catalogue), plus any published station IDs/jingles, cached in KV keyed on
 * exactly which tracks/assets currently qualify.
 *
 * Returns the loop and how many seconds into it the broadcast is right now.
 * This is the pre-Scheduler behaviour, still used for channels the
 * Scheduler isn't driving yet (and as its last-resort fallback).
 */
export async function loadStation(db: D1Database, kv: KVNamespace, channel: Channel, nowMs = Date.now()): Promise<Station> {
  const loop = await loadStationLoop(db, kv, channel, { nowMs });
  if (!loop.items) return { items: null, ...(loop.programme ? { programme: loop.programme } : {}) };
  const elapsed = Math.floor(((nowMs - loop.anchorMs) / 1000) % (loop.loopMs / 1000));
  return { items: loop.items, elapsed, programme: loop.programme };
}

// Jingles pinned to specific songs (published jingles only).
export async function loadPinnedJingles(db: D1Database): Promise<PinnedJingle[]> {
  const { results } = await db
    .prepare(
      `SELECT tj.track_id, tj.audio_asset_id AS asset_id, tj.start_offset_seconds,
              aa.title AS label, aa.audio_url, aa.duration_seconds, aa.duck_level, aa.duck_fade_ms
       FROM track_jingles tj
       JOIN audio_assets aa ON aa.id = tj.audio_asset_id
       WHERE aa.status = 'published'`
    )
    .all<PinnedJingle>();
  return results;
}

/** Adds each song's artist and album, and the album's artwork when the song has none. */
export async function enrichItems<T extends RotationItem | null>(db: D1Database, items: T[]): Promise<T[]> {
  const trackIds = Array.from(new Set(items.map((i) => i?.track_id).filter((id): id is string => !!id)));
  const albumByTrack = new Map<
    string,
    { artist: string | null; album_id: string | null; album_title: string | null; album_artwork_url: string | null }
  >();
  if (trackIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT t.id, t.artist, t.album_id, a.title AS album_title, a.artwork_url AS album_artwork_url
         FROM tracks t LEFT JOIN albums a ON a.id = t.album_id
         WHERE t.id IN (${trackIds.map(() => "?").join(",")})`
      )
      .bind(...trackIds)
      .all<{
        id: string;
        artist: string | null;
        album_id: string | null;
        album_title: string | null;
        album_artwork_url: string | null;
      }>();
    for (const row of results) albumByTrack.set(row.id, row);
  }

  return items.map((item) => {
    if (!item) return item;
    const album = item.track_id ? albumByTrack.get(item.track_id) : undefined;
    return {
      ...item,
      artist: album?.artist ?? null,
      album_id: album?.album_id ?? null,
      album_title: album?.album_title ?? null,
      artwork_url: item.artwork_url ?? album?.album_artwork_url ?? null,
    };
  });
}

export { stationToday };
