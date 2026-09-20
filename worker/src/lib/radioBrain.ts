import type { Track, AudioAsset } from "./types";

// A jingle that plays *over* a song rather than between songs. It takes no
// time of its own in the running order - the song carries on underneath - so
// it hangs off the song as data, and the player mixes it in live.
export interface RotationOverlay {
  asset_id: string;
  label: string;
  audio_url: string;
  duration_seconds: number;
  start_offset_seconds: number; // how far into the song the voice comes in
  duck_level: number; // music volume while the voice plays (fraction of full)
  duck_fade_ms: number; // length of each volume ramp, down and back up
}

export interface RotationItem {
  id: string;
  item_type: string;
  label: string | null;
  track_id: string | null;
  audio_asset_id: string | null;
  duration_seconds: number;
  audio_url: string | null;
  artwork_url: string | null;
  overlays?: RotationOverlay[];
  // Filled in when a now-playing response is built (not stored in cached rotations):
  artist?: string | null;
  album_id?: string | null;
  album_title?: string | null;
}

// A jingle Kizzi has pinned to a particular song: it plays over that song
// every time the song comes up, on top of the regular rotation jingles.
export interface PinnedJingle {
  track_id: string;
  asset_id: string;
  label: string;
  audio_url: string;
  duration_seconds: number;
  start_offset_seconds: number;
  duck_level: number;
  duck_fade_ms: number;
}

/**
 * Attach each song's pinned jingles to it as overlays. Several jingles on one
 * song are kept in order and spaced so they never talk over each other, and
 * none is allowed to start so late that it would run past the end of the song.
 * Pure data: the running-order timeline does not change (a ducked jingle takes
 * no time of its own), and songs with no pins come back untouched.
 */
export function withPinnedJingles(items: RotationItem[], pins: PinnedJingle[]): RotationItem[] {
  if (pins.length === 0) return items;

  const byTrack = new Map<string, PinnedJingle[]>();
  for (const pin of pins) byTrack.set(pin.track_id, [...(byTrack.get(pin.track_id) ?? []), pin]);

  return items.map((item) => {
    const mine = item.item_type === "song" && item.track_id ? byTrack.get(item.track_id) : undefined;
    if (!mine) return item;

    let earliest = 0;
    const overlays: RotationOverlay[] = [...mine]
      .sort((a, b) => a.start_offset_seconds - b.start_offset_seconds)
      .map((pin) => {
        const latest = Math.max(0, item.duration_seconds - pin.duration_seconds - 2);
        const start = Math.min(Math.max(pin.start_offset_seconds, earliest), latest);
        earliest = start + pin.duration_seconds + 3;
        return {
          asset_id: pin.asset_id,
          label: pin.label,
          audio_url: pin.audio_url,
          duration_seconds: pin.duration_seconds,
          start_offset_seconds: start,
          duck_level: pin.duck_level,
          duck_fade_ms: pin.duck_fade_ms,
        };
      });
    return { ...item, overlays };
  });
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
export function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return h;
}

export function seededShuffle<T>(arr: T[], seed: number): T[] {
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
export function buildRotation(
  seedKey: string,
  tracks: Track[],
  stationIds: AudioAsset[],
  pins: PinnedJingle[] = []
): RotationItem[] {
  if (tracks.length === 0) return [];

  // Each song plays at most once. Two rows with the same title are the same
  // song (e.g. it was uploaded on a single and again on an album), so only
  // the first is kept.
  const seenTitles = new Set<string>();
  const unique = tracks.filter((t) => {
    const key = t.title.trim().toLowerCase();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  const shuffled = seededShuffle(unique, hashSeed(seedKey));
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

  return insertStationIds(withPinnedJingles(songItems, pins), stationIds, hashSeed(seedKey + ":ids"));
}

// Rejection-based local smoothing: if two adjacent tracks share an album,
// swap the second one for the next track down the list that doesn't
// collide. Bounded and best-effort - a pool dominated by one album simply
// can't avoid every collision, and that's fine.
export function spaceOutAlbums(tracks: Track[]): Track[] {
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

export function insertStationIds(
  items: RotationItem[],
  stationIds: AudioAsset[],
  seed: number,
  opts: { leading?: boolean } = {}
): RotationItem[] {
  if (stationIds.length === 0) return items;

  const rand = mulberry32(seed);
  const out: RotationItem[] = [];
  let sinceLastId = 0;
  let nextIdIndex = 0;

  // A ducked jingle isn't a running-order item: it waits here and is attached
  // to the next song, coming in a few seconds after that song starts - the
  // usual radio "voice over the intro".
  let pendingOverlay: AudioAsset | null = null;

  const pushStationId = () => {
    const asset = stationIds[nextIdIndex % stationIds.length];
    if (asset.play_mode === "duck_over_music") {
      pendingOverlay = asset;
      nextIdIndex++;
      sinceLastId = 0;
      return;
    }
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
  };

  if (opts.leading) pushStationId();

  for (const source of items) {
    let item = source;
    // A song that already carries pinned jingles waits: the rotation jingle goes on the next song.
    if (pendingOverlay && item.item_type === "song" && !item.overlays?.length) {
      const asset: AudioAsset = pendingOverlay;
      pendingOverlay = null;
      // 4-12 s in, but never so late that the jingle would run past the end.
      const latest = Math.max(0, item.duration_seconds - asset.duration_seconds - 5);
      item = {
        ...item,
        overlays: [
          {
            asset_id: asset.id,
            label: asset.title,
            audio_url: asset.audio_url,
            duration_seconds: asset.duration_seconds,
            start_offset_seconds: Math.min(Math.round(4 + rand() * 8), Math.round(latest)),
            duck_level: asset.duck_level,
            duck_fade_ms: asset.duck_fade_ms,
          },
        ],
      };
    }
    out.push(item);
    sinceLastId += item.duration_seconds;
    // 15-20 minutes, randomised (but seeded) per insertion so it doesn't
    // feel metronomic.
    const target = STATION_ID_TARGET_SECONDS + (rand() - 0.5) * 5 * 60;
    if (sinceLastId >= target) {
      pushStationId();
    }
  }
  return out;
}

// Arranges a pool into a session arc - an energetic-leaning open, a steady
// middle, a wind-down close - by clustering tracks tagged with a "high" or
// "low" energy tier at either end. A no-op once every track shares the same
// tier (today: none of them are tagged, so this returns the pool unchanged
// until energy tags actually exist).
function energyArc(tracks: Track[]): Track[] {
  const high = tracks.filter((t) => t.energy === "high");
  const low = tracks.filter((t) => t.energy === "low");
  if (high.length === 0 && low.length === 0) return tracks;

  const rest = tracks.filter((t) => t.energy !== "high" && t.energy !== "low");
  return [...high, ...rest, ...low];
}

/**
 * Phase 2 of the roadmap: a listener-facing "build my own session" - pick a
 * mood and a duration, get a running order back instantly. Still the Radio
 * Brain, still zero AI calls, just called with a listener's filter instead
 * of a channel's fixed catalogue_rules.
 *
 * Unlike an autopilot channel's rotation, a session has no "many listeners
 * must all hear the same thing right now" requirement - it's personal and
 * on-demand, so seedKey should include something request-specific (the
 * route handler mixes in the current time) so tapping "build" again gives a
 * fresh mix rather than the identical session every time.
 */
export function buildSession(
  seedKey: string,
  tracks: Track[],
  stationIds: AudioAsset[],
  targetDurationSeconds: number,
  pins: PinnedJingle[] = []
): RotationItem[] {
  if (tracks.length === 0) return [];

  const shuffled = seededShuffle(tracks, hashSeed(seedKey));
  const spaced = spaceOutAlbums(shuffled);
  const arced = energyArc(spaced);

  // Fill to roughly the target duration, always finishing the track that
  // crosses the threshold rather than cutting it short. If the mood doesn't
  // have enough music to reach the target, the session is simply shorter -
  // songs are never repeated to pad it out.
  const picked: Track[] = [];
  let total = 0;
  for (const t of arced) {
    if (total >= targetDurationSeconds) break;
    picked.push(t);
    total += t.duration_seconds;
  }

  const songItems: RotationItem[] = picked.map((t, idx) => ({
    id: `${t.id}-${idx}`,
    item_type: "song",
    label: t.title,
    track_id: t.id,
    audio_asset_id: null,
    duration_seconds: t.duration_seconds,
    audio_url: t.audio_url,
    artwork_url: t.artwork_url,
  }));

  return insertStationIds(withPinnedJingles(songItems, pins), stationIds, hashSeed(seedKey + ":ids"), { leading: true });
}

// --------------------------------------------------------------------------
// "Radio That Knows You": a short produced programme for one listener.
//
// Everything here is a rule over the catalogue - no AI, no per-listener cost:
//   * songs come from the tags the chosen need maps to, never repeating;
//   * roughly one slot in five is a WILDCARD - a song from a looser tag match
//     (shares the mood, not the genre) instead of the obvious pick;
//   * Kizzi's pre-recorded spoken links are chosen from the link bank by kind
//     and mood: an intro, links between songs, an outro;
//   * a station ID opens it (and pinned/ducked jingles work as everywhere else);
//   * the name is picked from the title bank.
// Seeded, so the same seed always builds the same programme.
// --------------------------------------------------------------------------

export interface LinkClip {
  id: string;
  title: string;
  audio_url: string;
  duration_seconds: number;
  link_kind: string; // intro | transition | fun_fact | observation | outro
  tags: string[]; // moods it suits; none = suits anything
}

export interface ProgrammeTitle {
  title: string;
  time_band: string | null;
}

const LINK_BUDGET_SHARE = 0.2; // spoken links never take more than ~20% of the song time

function uniqueByTitle(tracks: Track[], exclude: Set<string> = new Set()): Track[] {
  const seen = new Set(exclude);
  return tracks.filter((t) => {
    const key = t.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildProgramme(opts: {
  seedKey: string;
  needKey: string;
  matchTags: string[]; // tags a link must carry (any) to count as made for this need
  mainTracks: Track[];
  wildcardTracks: Track[];
  links: LinkClip[];
  stationIds: AudioAsset[];
  pins: PinnedJingle[];
  titles: ProgrammeTitle[];
  songCount: number; // how many songs the programme has (fewer only if the catalogue runs out)
  band?: string | null;
}): {
  title: string;
  items: RotationItem[];
  total_duration_seconds: number;
  wildcard_count: number;
  link_count: number;
} {
  const { seedKey, songCount } = opts;
  const rand = mulberry32(hashSeed(seedKey));

  // ---- songs
  const main = spaceOutAlbums(seededShuffle(uniqueByTitle(opts.mainTracks), hashSeed(seedKey + ":main")));
  const mainTitles = new Set(main.map((t) => t.title.trim().toLowerCase()));
  const wild = seededShuffle(uniqueByTitle(opts.wildcardTracks, mainTitles), hashSeed(seedKey + ":wild"));

  // A programme is a set number of songs (this catalogue's songs run about 6 minutes
  // each, so the length in minutes follows from the count rather than the other way
  // round - asking for minutes gave 2 songs, which doesn't feel like a programme).
  const songs: { track: Track; wildcard: boolean }[] = [];
  let songSeconds = 0;
  while (songs.length < songCount && (main.length > 0 || wild.length > 0)) {
    const slot = songs.length;
    let useWild = slot >= 1 && wild.length > 0 && rand() < 0.2;
    // A programme might never roll a wildcard; make sure a longer one has one.
    if (!useWild && slot === 3 && wild.length > 0 && !songs.some((s) => s.wildcard)) useWild = true;
    const next = useWild ? wild[0] : (main[0] ?? wild[0]);
    if (useWild) wild.shift();
    else if (main.length > 0) main.shift();
    else wild.shift();
    songs.push({ track: next, wildcard: useWild });
    songSeconds += next.duration_seconds;
  }

  // ---- spoken links
  const wanted = new Set([opts.needKey, ...opts.matchTags]);
  const used = new Set<string>();
  const pick = (kinds: string[]): LinkClip | null => {
    // A link made for this need and a generic (untagged, "suits any mood") one are equally
    // welcome, so recordings made for any mood actually get played; links made for other
    // needs are left out.
    const candidates = opts.links.filter(
      (l) => kinds.includes(l.link_kind) && !used.has(l.id) && (l.tags.length === 0 || l.tags.some((t) => wanted.has(t)))
    );
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.floor(rand() * candidates.length)];
    used.add(chosen.id);
    return chosen;
  };
  const budget = songSeconds * LINK_BUDGET_SHARE;
  let linkSeconds = 0;
  let linkCount = 0;

  const items: RotationItem[] = [];
  const addLink = (clip: LinkClip | null) => {
    if (!clip || linkSeconds + clip.duration_seconds > budget) return;
    linkSeconds += clip.duration_seconds;
    linkCount++;
    items.push({
      id: `${clip.id}-${items.length}`,
      item_type: "link",
      label: clip.title,
      track_id: null,
      audio_asset_id: clip.id,
      duration_seconds: clip.duration_seconds,
      audio_url: clip.audio_url,
      artwork_url: null,
    });
  };

  addLink(pick(["intro"]));
  songs.forEach(({ track }, i) => {
    items.push({
      id: `${track.id}-${items.length}`,
      item_type: "song",
      label: track.title,
      track_id: track.id,
      audio_asset_id: null,
      duration_seconds: track.duration_seconds,
      audio_url: track.audio_url,
      artwork_url: track.artwork_url,
    });
    if (i < songs.length - 1 && rand() < 0.75) {
      addLink(pick(i % 2 === 0 ? ["transition", "observation"] : ["fun_fact", "observation", "transition"]));
    }
  });
  addLink(pick(["outro"]));

  const withJingles = insertStationIds(withPinnedJingles(items, opts.pins), opts.stationIds, hashSeed(seedKey + ":ids"), {
    leading: true,
  });

  // ---- the name
  const { titles, band } = opts;
  const byBand = band ? titles.filter((t) => t.time_band === band) : [];
  const anyTime = titles.filter((t) => !t.time_band);
  // Titles for this time of day and the all-day ones are both fair game, so a need
  // that has one late-night title doesn't repeat it every night.
  const timed = [...byBand, ...anyTime];
  const pool = timed.length > 0 ? timed : titles;
  const title = pool.length > 0 ? pool[Math.floor(rand() * pool.length)].title : "Your Radio";

  return {
    title,
    items: withJingles,
    total_duration_seconds: withJingles.reduce((sum, i) => sum + i.duration_seconds, 0),
    wildcard_count: songs.filter((s) => s.wildcard).length,
    link_count: linkCount,
  };
}
