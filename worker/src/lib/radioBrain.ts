import type { Track, AudioAsset } from "./types";

export interface RotationItem {
  id: string;
  item_type: string;
  label: string | null;
  track_id: string | null;
  audio_asset_id: string | null;
  duration_seconds: number;
  audio_url: string | null;
  artwork_url: string | null;
}

// Given a loop of items and how many seconds have elapsed since some fixed
// reference point, find which item is "playing" right now and how far into
// it we are - looping back to the start once the total duration is passed.
// Shared by every playback mode (a hand-built programme, an on-demand
// session, an autopilot rotation) - only what counts as "the loop" and
// "the reference point" differ between them.
export function locateInLoop(items: RotationItem[], elapsedSeconds: number) {
  let cursor = 0;
  let currentIndex = 0;
  for (let i = 0; i < items.length; i++) {
    if (elapsedSeconds < cursor + items[i].duration_seconds) {
      currentIndex = i;
      break;
    }
    cursor += items[i].duration_seconds;
    currentIndex = i;
  }
  return { currentIndex, position_seconds: elapsedSeconds - cursor };
}

// Deterministic PRNG (mulberry32) so the same seed always produces the same
// shuffle - every listener computing a channel's rotation independently
// must arrive at the identical running order, with no shared state or
// per-play database writes (brief: "zero per-play AI calls", extended here
// to zero per-play *anything* - this is pure arithmetic on a cached list).
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return h;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const STATION_ID_TARGET_SECONDS = 17.5 * 60; // midpoint of the brief's 15-20 min
const ENERGY_TIERS = ["low", "medium", "high"];

/**
 * The Radio Brain (handoff_radio_brain_roadmap.md, Phase 1): builds one
 * rotation for an autopilot channel from a pool of tracks and any published
 * station IDs/jingles, applying cheap deterministic rules - no AI calls,
 * nothing persisted per play. The whole rotation is generated once (per
 * seedKey - now-playing uses one seed per channel per day, so it's a fresh
 * shuffle daily) and then looped exactly like a hand-built programme, via
 * locateInLoop above.
 *
 * Two rules from the brief can't be meaningfully enforced on this catalogue
 * yet and are applied best-effort, activating automatically once the data
 * exists rather than being skipped outright:
 * - "don't repeat the same artist back-to-back" - there's no artist field
 *   yet (every track is Kizzi's own), so this uses album_id as the closest
 *   available grouping until a real artist field exists.
 * - "alternate energy levels" - most tracks don't have `energy` tagged yet;
 *   untagged tracks form their own neutral tier, so this rule has no
 *   visible effect until energy tags are actually filled in.
 * "Don't repeat a track within a window" is satisfied structurally instead
 * of by tracking play history: every track in the pool appears exactly
 * once per rotation, so nothing repeats until the whole pool has played -
 * which only gets closer to the brief's literal "6 hours" as the catalogue
 * grows (see the roadmap's own Phase 3 gating note on catalogue size).
 */
export function buildRotation(seedKey: string, tracks: Track[], stationIds: AudioAsset[]): RotationItem[] {
  if (tracks.length === 0) return [];

  const shuffled = seededShuffle(tracks, hashSeed(seedKey));
  const spaced = spaceOutAlbums(shuffled);
  const paced = alternateEnergy(spaced);

  const songItems: RotationItem[] = paced.map((t) => ({
    id: t.id,
    item_type: "song",
    label: t.title,
    track_id: t.id,
    audio_asset_id: null,
    duration_seconds: t.duration_seconds,
    audio_url: t.audio_url,
    artwork_url: t.artwork_url,
  }));

  return insertStationIds(songItems, stationIds, hashSeed(seedKey + ":ids"));
}

// Rejection-based local smoothing: if two adjacent tracks share an album,
// swap the second one for the next track down the list that doesn't
// collide. Bounded and best-effort - a pool dominated by one album simply
// can't avoid every collision, and that's fine.
function spaceOutAlbums(tracks: Track[]): Track[] {
  const out = [...tracks];
  for (let i = 1; i < out.length; i++) {
    if (!out[i].album_id || out[i].album_id !== out[i - 1].album_id) continue;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].album_id !== out[i - 1].album_id) {
        [out[i], out[j]] = [out[j], out[i]];
        break;
      }
    }
  }
  return out;
}

// Groups tracks by energy tier (untagged tracks form their own group) and
// round-robins across tiers so three high-energy tracks never run in a row.
function alternateEnergy(tracks: Track[]): Track[] {
  const tiers = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = t.energy && ENERGY_TIERS.includes(t.energy) ? t.energy : "untagged";
    if (!tiers.has(key)) tiers.set(key, []);
    tiers.get(key)!.push(t);
  }
  if (tiers.size <= 1) return tracks;

  const queues = Array.from(tiers.values());
  const out: Track[] = [];
  let remaining = tracks.length;
  let i = 0;
  while (remaining > 0) {
    const queue = queues[i % queues.length];
    if (queue.length > 0) {
      out.push(queue.shift()!);
      remaining--;
    }
    i++;
  }
  return out;
}

function insertStationIds(items: RotationItem[], stationIds: AudioAsset[], seed: number): RotationItem[] {
  if (stationIds.length === 0) return items;

  const rand = mulberry32(seed);
  const out: RotationItem[] = [];
  let sinceLastId = 0;
  let nextIdIndex = 0;

  for (const item of items) {
    out.push(item);
    sinceLastId += item.duration_seconds;
    // 15-20 minutes, randomised (but seeded) per insertion so it doesn't
    // feel metronomic.
    const target = STATION_ID_TARGET_SECONDS + (rand() - 0.5) * 5 * 60;
    if (sinceLastId >= target) {
      const asset = stationIds[nextIdIndex % stationIds.length];
      out.push({
        id: `${asset.id}-${out.length}`,
        item_type: asset.type === "jingle" || asset.type === "promo" ? "station_id" : asset.type,
        label: asset.title,
        track_id: null,
        audio_asset_id: asset.id,
        duration_seconds: asset.duration_seconds,
        audio_url: asset.audio_url,
        artwork_url: null,
      });
      nextIdIndex++;
      sinceLastId = 0;
    }
  }
  return out;
}
