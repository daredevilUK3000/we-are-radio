import { Hono } from "hono";
import type { Env, Programme, Channel, Track, AudioAsset } from "../lib/types";
import { findNeed, NEEDS, NEED_KEYS } from "../lib/needs";
import { addDays, parseCapsuleFields, stationToday } from "../lib/capsules";
import { enrichItems, loadPinnedJingles, loadStation } from "../lib/station";
import { nowPlayingFromLog, scheduleFromLog, schedState } from "../lib/scheduler/read";
import { blocksAround, buildGuide } from "../lib/guide";
import { newId, nowIso } from "../lib/id";
import {
  buildRotation,
  buildSession,
  hashSeed,
  locateInLoop,
  withPinnedJingles,
  buildProgramme,
  type LinkClip,
  type ProgrammeTitle,
  type PinnedJingle,
  type RotationItem,
  type RotationOverlay,
} from "../lib/radioBrain";

export const publicRoutes = new Hono<{ Bindings: Env }>();

// Listener-facing catalogue reads. Deliberately separate from the Studio CRUD
// routers (routes/tracks.ts etc.) so "published/live only" is enforced here,
// in one place, rather than trusted to a query-param on the admin routes.

publicRoutes.get("/channels", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM channels WHERE status = 'live' ORDER BY created_at ASC"
  ).all();
  return c.json({ channels: results });
});

publicRoutes.get("/channels/:slug", async (c) => {
  const channel = await c.env.DB.prepare(
    "SELECT * FROM channels WHERE slug = ? AND status = 'live'"
  )
    .bind(c.req.param("slug"))
    .first();
  if (!channel) return c.json({ error: "not found" }, 404);
  return c.json({ channel });
});

publicRoutes.get("/albums", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM albums ORDER BY release_date DESC, created_at DESC LIMIT 200"
  ).all();
  return c.json({ albums: results });
});

publicRoutes.get("/albums/:id", async (c) => {
  const album = await c.env.DB.prepare("SELECT * FROM albums WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!album) return c.json({ error: "not found" }, 404);

  const { results: tracks } = await c.env.DB.prepare(
    "SELECT * FROM tracks WHERE album_id = ? AND status = 'published' ORDER BY track_number ASC"
  )
    .bind(album.id as string)
    .all();

  return c.json({
    album,
    tracks: await withPinnedOverlays(
      c.env.DB,
      tracks as any[],
      (t) => t.id,
      (t) => t.duration_seconds
    ),
  });
});

publicRoutes.get("/tracks", async (c) => {
  const q = c.req.query("q");
  let sql = "SELECT * FROM tracks WHERE status = 'published'";
  const params: unknown[] = [];
  if (q) {
    sql += " AND title LIKE ?";
    params.push(`%${q}%`);
  }
  sql += " ORDER BY created_at DESC LIMIT 1000";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ tracks: results });
});

publicRoutes.get("/tracks/:id", async (c) => {
  // Same album fallback as the album listing itself uses: a track with no
  // artwork of its own (common - most tracks are shipped as part of an
  // album, not individually) shows the album's cover instead of nothing.
  const track = await c.env.DB.prepare(
    `SELECT t.*, a.title AS album_title, a.artwork_url AS album_artwork_url
     FROM tracks t LEFT JOIN albums a ON a.id = t.album_id
     WHERE t.id = ? AND t.status = 'published'`
  )
    .bind(c.req.param("id"))
    .first<Track & { album_title: string | null; album_artwork_url: string | null }>();
  if (!track) return c.json({ error: "not found" }, 404);

  const { results: tags } = await c.env.DB.prepare(
    `SELECT tg.id, tg.name FROM tags tg
     JOIN track_tags tt ON tt.tag_id = tg.id
     WHERE tt.track_id = ?`
  )
    .bind(track.id)
    .all();

  // A track played on its own shareable page still needs whatever jingle is
  // pinned to it - the same withPinnedOverlays every other direct-play route
  // (an album, a programme) already goes through, not a bare audio file.
  const [withOverlay] = await withPinnedOverlays(c.env.DB, [track], (t) => t.id, (t) => t.duration_seconds);

  return c.json({ track: withOverlay, tags });
});

publicRoutes.get("/programmes", async (c) => {
  const channelId = c.req.query("channel_id");
  const flagship = c.req.query("is_flagship");
  let sql = "SELECT * FROM programmes WHERE status = 'published'";
  const params: unknown[] = [];
  if (channelId) {
    sql += " AND channel_id = ?";
    params.push(channelId);
  }
  if (flagship === "1") sql += " AND is_flagship = 1";
  sql += " ORDER BY publish_date DESC LIMIT 200";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ programmes: results });
});

// Podcast Importer episodes are just programmes underneath, but a listener
// browsing shouldn't have to know that - this finds them by the actual
// technical fact that makes them podcast episodes (their audio comes from
// storage='external', i.e. pulled in from an RSS feed rather than
// recorded/uploaded), regardless of which channel they landed in.
publicRoutes.get("/podcasts", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 200, 1), 200);
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT p.* FROM programmes p
     JOIN programme_items pi ON pi.programme_id = p.id
     JOIN audio_assets aa ON aa.id = pi.audio_asset_id
     WHERE p.status = 'published' AND aa.storage = 'external'
     ORDER BY p.publish_date DESC, p.created_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();
  return c.json({ podcasts: results });
});

// Landing-page Podcasts section: each show's latest episode (the spotlight
// cards) plus the most recent episodes across all shows (the "More Recent
// Episodes" row). Grouped here rather than in the browser so the homepage
// doesn't download every episode's show notes. Episodes with no show_name
// (imported before shows were named) only appear in `recent`.
publicRoutes.get("/podcasts/showcase", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT p.id, p.title, p.show_name, p.episode_number, p.duration_seconds, p.publish_date, p.created_at
     FROM programmes p
     JOIN programme_items pi ON pi.programme_id = p.id
     JOIN audio_assets aa ON aa.id = pi.audio_asset_id
     WHERE p.status = 'published' AND aa.storage = 'external'
     ORDER BY p.publish_date DESC, p.created_at DESC
     LIMIT 200`
  ).all<any>();

  const latestByShow = new Map<string, any>();
  for (const ep of results) {
    if (ep.show_name && !latestByShow.has(ep.show_name)) latestByShow.set(ep.show_name, ep);
  }
  return c.json({ shows: Array.from(latestByShow.values()), recent: results.slice(0, 12) });
});

// The album the homepage showcases. Kizzi picks it in the Studio
// (albums.is_featured); until she has, falls back to the newest album that
// actually has something playable, so the section is never empty or broken
// - and never hardcoded to one album either way.
publicRoutes.get("/featured-album", async (c) => {
  let album = await c.env.DB.prepare("SELECT * FROM albums WHERE is_featured = 1 LIMIT 1").first();
  if (!album) {
    album = await c.env.DB.prepare(
      `SELECT a.* FROM albums a
       WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.status = 'published')
       ORDER BY a.release_date DESC, a.created_at DESC LIMIT 1`
    ).first();
  }
  if (!album) return c.json({ album: null, tracks: [] });

  const { results: tracks } = await c.env.DB.prepare(
    `SELECT * FROM tracks WHERE album_id = ? AND status = 'published'
     ORDER BY track_number ASC, created_at ASC`
  )
    .bind(album.id as string)
    .all();

  return c.json({ album, tracks });
});

publicRoutes.get("/programmes/:id", async (c) => {
  const programme = await c.env.DB.prepare(
    "SELECT * FROM programmes WHERE id = ? AND status = 'published'"
  )
    .bind(c.req.param("id"))
    .first<Programme>();
  if (!programme) return c.json({ error: "not found" }, 404);

  const { results: items } = await c.env.DB.prepare(
    `SELECT pi.*, t.title as track_title, t.duration_seconds as track_duration_seconds, t.audio_url as track_audio_url, t.artwork_url as track_artwork_url,
            aa.title as audio_asset_title, aa.duration_seconds as audio_asset_duration_seconds, aa.audio_url as audio_asset_audio_url
     FROM programme_items pi
     LEFT JOIN tracks t ON t.id = pi.track_id
     LEFT JOIN audio_assets aa ON aa.id = pi.audio_asset_id
     WHERE pi.programme_id = ?
     ORDER BY pi.position ASC`
  )
    .bind(programme.id)
    .all();

  return c.json({
    programme,
    items: await withPinnedOverlays(
      c.env.DB,
      items as any[],
      (i) => (i.item_type === "song" ? i.track_id : null),
      (i) => i.track_duration_seconds ?? 0
    ),
  });
});

/**
 * The live log version for a channel the Scheduler drives, so players can
 * poll cheaply (every 10 s) and refetch now-playing the moment it changes.
 * One indexed D1 read; not KV, which can take a minute to propagate.
 * Channels still on the old path report version 0.
 */
publicRoutes.get("/now-playing/version", async (c) => {
  c.header("Cache-Control", "no-store");
  const slug = c.req.query("channel") ?? "kizzi-radio";
  const row = await c.env.DB.prepare(
    `SELECT sc.enabled, sc.on_fallback_since_ms,
            (SELECT COALESCE(MAX(v.number), 0) FROM sched_versions v WHERE v.channel_id = ch.id AND v.status = 'published') AS live
     FROM channels ch LEFT JOIN sched_channels sc ON sc.channel_id = ch.id
     WHERE ch.slug = ? AND ch.status = 'live'`
  )
    .bind(slug)
    .first<{ enabled: number | null; on_fallback_since_ms: number | null; live: number }>();
  if (!row) return c.json({ error: "channel not found or not live" }, 404);
  return c.json({ version: row.enabled ? row.live : 0, fallback: !!(row.enabled && row.on_fallback_since_ms) });
});

/** What /now-playing answers for one live channel: the log when the Scheduler drives it, else the old loop. */
async function nowPlayingFor(env: Env, channel: Channel, waitUntil: (p: Promise<unknown>) => void): Promise<any> {
  // Scheduler on air for this channel: the log (or its emergency playlist).
  const sched = await schedState(env.DB, channel.id).catch(() => null);
  if (sched?.enabled) {
    const body = await nowPlayingFromLog(env, channel, sched, Date.now(), waitUntil);
    if (body) return body;
  }

  const station = await loadStation(env.DB, env.CONFIG, channel);
  if (!station.items) {
    return { channel, ...(station.programme ? { programme: station.programme } : {}), on_air: false };
  }
  const { currentIndex, position_seconds } = locateInLoop(station.items, station.elapsed);

  return {
    channel,
    programme: station.programme,
    on_air: true,
    position_seconds,
    ...(await describePlayback(env.DB, station.items, currentIndex)),
  };
}

publicRoutes.get("/now-playing", async (c) => {
  const channel = await liveChannel(c.env.DB, c.req.query("channel") ?? "kizzi-radio");
  if (!channel) return c.json({ error: "channel not found or not live" }, 404);
  return c.json(await nowPlayingFor(c.env, channel, (p) => c.executionCtx.waitUntil(p)));
});

/**
 * GET /api/now-playing/all - every live channel at once, for the TV Home
 * screen (handoff_tv_firetv.md §A3): what's on, how far in, the block on now
 * and the next one. No audio URLs. The same for everyone: cached 10 s.
 */
publicRoutes.get("/now-playing/all", async (c) => {
  const cacheKey = new Request(`${new URL(c.req.url).origin}/api/now-playing/all`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  const { results: channels } = await c.env.DB.prepare(
    `SELECT ch.*, COALESCE(sc.enabled, 0) AS sched_enabled FROM channels ch
     LEFT JOIN sched_channels sc ON sc.channel_id = ch.id WHERE ch.status = 'live' ORDER BY ch.created_at ASC`
  ).all<Channel & { sched_enabled: number }>();
  const now = Date.now();
  const rows = await Promise.all(
    channels.map(async ({ sched_enabled, ...ch }) => {
      const np = await nowPlayingFor(c.env, ch, (p) => c.executionCtx.waitUntil(p)).catch(() => null);
      const item = np?.on_air ? np.now_playing : null;
      const blocks = sched_enabled ? await blocksAround(c.env, ch.id, now).catch(() => null) : null;
      return {
        slug: ch.slug,
        on_air: !!np?.on_air,
        title: item?.label ?? null,
        artist: item?.artist ?? null,
        artwork_url: item?.artwork_url ?? null,
        item_type: item?.item_type ?? null,
        position_seconds: np?.on_air ? (np.position_seconds ?? 0) : null,
        duration_seconds: item?.duration_seconds ?? null,
        // A listener's voice note: only the public details the players show.
        voice: item?.voice ?? null,
        block: blocks?.block ?? null,
        next_block: blocks?.next_block ?? null,
      };
    })
  );
  const res = c.json({ generated_at: Math.round(now / 1000), channels: rows }, 200, { "Cache-Control": "public, max-age=10" });
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
});

/**
 * GET /api/guide?days=7 - the week's programme guide for the TV What's on
 * screen (and Release 2's public /schedule page). See lib/guide.ts.
 */
publicRoutes.get("/guide", async (c) => {
  const days = Math.min(7, Math.max(1, Math.floor(Number(c.req.query("days")) || 7)));
  return c.json(await buildGuide(c.env, days), 200, { "Cache-Control": "public, max-age=300" });
});

/**
 * The channel's running order from now on - what a Chromecast queue (and,
 * later, an offline download) needs: every item, jingles and station IDs
 * included, each with the moment it starts on air. The first item is the one
 * on air now, already `position_seconds` in. Covers `minutes` (default 60,
 * at most 180) of air time, however many loops of the rotation that takes.
 * Live channels only, like /now-playing.
 */
publicRoutes.get("/schedule", async (c) => {
  const channel = await liveChannel(c.env.DB, c.req.query("channel") ?? "kizzi-radio");
  if (!channel) return c.json({ error: "channel not found or not live" }, 404);

  const minutes = Math.min(180, Math.max(1, Number(c.req.query("minutes")) || 60));
  const sched = await schedState(c.env.DB, channel.id).catch(() => null);
  if (sched?.enabled) {
    const body = await scheduleFromLog(c.env, channel, sched, Date.now(), minutes);
    if (body) return c.json(body);
  }
  const station = await loadStation(c.env.DB, c.env.CONFIG, channel);
  if (!station.items) return c.json({ channel, on_air: false, items: [] });

  const { items } = station;
  const { currentIndex, position_seconds } = locateInLoop(items, station.elapsed);
  const nowSec = Math.floor(Date.now() / 1000);
  let startsAt = nowSec - position_seconds;
  const horizon = nowSec + minutes * 60;
  const picked: { item: RotationItem; starts_at: number }[] = [];
  // A rotation of zero-length items would never reach the horizon.
  for (let step = 0; startsAt < horizon && step < 1000; step++) {
    const item = items[(currentIndex + step) % items.length];
    if (item.duration_seconds > 0) picked.push({ item, starts_at: startsAt });
    startsAt += item.duration_seconds;
  }

  const enriched = await enrichItems(c.env.DB, picked.map((p) => p.item));
  return c.json({
    channel,
    programme: station.programme,
    on_air: true,
    position_seconds,
    items: picked.map((p, i) => ({
      ...enriched[i],
      // Overlay jingles are played by the listener's browser over a song; a
      // queue can't do that, so they're left out rather than sent unused.
      overlays: undefined,
      starts_at: p.starts_at,
    })),
  });
});

/**
 * GET /api/recently-played?channel=<slug>&limit=10 - "Just played" in the
 * players (handoff_player_upgrades.md §2.1). Songs only, from what actually
 * aired (sched_aired), newest first, each track once at its latest airing;
 * not the one on air now, nothing that aired for under 30 s, nothing older
 * than 3 hours, nothing no longer published. Never airing IDs, versions,
 * voice notes, links or anything from onair_messages. The same for everyone,
 * so it's cached at the edge for 30 s.
 */
publicRoutes.get("/recently-played", async (c) => {
  const slug = c.req.query("channel") ?? "kizzi-radio";
  const limit = Math.min(20, Math.max(1, Math.floor(Number(c.req.query("limit")) || 10)));
  // One cache entry per channel and limit, whatever else is on the address.
  const cacheKey = new Request(`${new URL(c.req.url).origin}/api/recently-played?channel=${encodeURIComponent(slug)}&limit=${limit}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  const channel = await liveChannel(c.env.DB, slug);
  if (!channel) return c.json({ error: "channel not found or not live" }, 404);
  const sched = await schedState(c.env.DB, channel.id).catch(() => null);
  let body: { available: boolean; items: unknown[] };
  if (!sched?.enabled) {
    // Channels not on the Scheduler have no record of what aired: the players hide the section.
    body = { available: false, items: [] };
  } else {
    const now = Date.now();
    const { results } = await c.env.DB.prepare(
      `SELECT a.track_id, t.title, t.artist, COALESCE(t.artwork_url, al.artwork_url) AS artwork_url,
              MAX(a.starts_at_ms) AS aired_ms
       FROM sched_aired a
       JOIN tracks t ON t.id = a.track_id AND t.status = 'published'
       LEFT JOIN albums al ON al.id = t.album_id
       WHERE a.channel_id = ?1 AND a.item_type = 'song' AND a.starts_at_ms > ?2 AND a.starts_at_ms <= ?3
         AND NOT (a.actual_end_ms IS NULL AND a.scheduled_end_ms > ?3)
         AND COALESCE(a.actual_end_ms, a.scheduled_end_ms) - a.starts_at_ms >= 30000
       GROUP BY a.track_id ORDER BY aired_ms DESC LIMIT ?4`
    )
      .bind(channel.id, now - 3 * 60 * 60 * 1000, now, limit)
      .all<{ track_id: string; title: string; artist: string | null; artwork_url: string | null; aired_ms: number }>();
    body = {
      available: true,
      items: results.map((r) => ({
        track_id: r.track_id,
        title: r.title,
        artist: r.artist,
        artwork_url: r.artwork_url,
        aired_at: Math.round(r.aired_ms / 1000),
      })),
    };
  }
  const res = c.json(body, 200, { "Cache-Control": "public, max-age=30" });
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
});

async function liveChannel(db: D1Database, slug: string) {
  return db.prepare("SELECT * FROM channels WHERE slug = ? AND status = 'live'").bind(slug).first<Channel>();
}

/**
 * What the Now Playing screen needs beyond "the current item": the next few
 * things on air (so the listener sees the flow of the station, not one track),
 * and for songs the album they belong to and its artwork as a fallback.
 * Station IDs are left out of the queue - listeners care about the songs and
 * talk, not that a jingle is coming. Four deep so the flagship Now Playing
 * page's "Up Next" rail (four queue cards) has real items to show.
 */
async function describePlayback(db: D1Database, items: RotationItem[], currentIndex: number) {
  const now = items[currentIndex];
  const upNext = items[currentIndex + 1] ?? null;

  const comingUp: RotationItem[] = [];
  for (let step = 1; step < items.length && comingUp.length < 4; step++) {
    const item = items[(currentIndex + step) % items.length];
    if (item.item_type !== "station_id" && item.id !== now.id) comingUp.push(item);
  }

  const [nowE, upNextE, ...comingUpE] = await enrichItems(db, [now, upNext, ...comingUp]);
  return { now_playing: nowE, up_next: upNextE, coming_up: comingUpE };
}

/**
 * Pinned jingles for songs played directly (an album, a programme page), not
 * only on a station: each row that is a song with pinned jingles comes back
 * with `overlays`, exactly as station items do, so the player can mix them in.
 */
async function withPinnedOverlays<T extends Record<string, any>>(
  db: D1Database,
  rows: T[],
  trackIdOf: (row: T) => string | null,
  durationOf: (row: T) => number
): Promise<(T & { overlays?: RotationOverlay[] })[]> {
  const pins = await loadPinnedJingles(db);
  if (pins.length === 0) return rows;
  const pseudo: RotationItem[] = rows.map((row, i) => ({
    id: String(i),
    item_type: "song",
    label: null,
    track_id: trackIdOf(row),
    audio_asset_id: null,
    duration_seconds: durationOf(row),
    audio_url: null,
    artwork_url: null,
  }));
  const done = withPinnedJingles(pseudo, pins);
  return rows.map((row, i) => (done[i].overlays ? { ...row, overlays: done[i].overlays } : row));
}

const SESSION_DURATIONS_MINUTES = [15, 30, 45, 60];

/**
 * Phase 2 of handoff_radio_brain_roadmap.md: a listener picks a mood and a
 * duration and gets a produced running order back instantly - the Radio
 * Brain called with a listener's filter instead of a channel's fixed
 * catalogue_rules. No account, no persistence of who asked for what
 * (nothing is written here at all) - each call is a fresh, independent
 * build, which is also why the seed mixes in the current time: repeat
 * taps should feel like a new mix, not the same session replayed.
 */
publicRoutes.post("/sessions", async (c) => {
  const body = await c.req.json<{ mood?: string; duration_minutes?: number }>().catch(() => ({}) as never);
  const mood = body.mood?.trim();
  const durationMinutes = body.duration_minutes;

  if (!mood) return c.json({ error: "mood is required" }, 400);
  if (!durationMinutes || !SESSION_DURATIONS_MINUTES.includes(durationMinutes)) {
    return c.json({ error: `duration_minutes must be one of ${SESSION_DURATIONS_MINUTES.join(", ")}` }, 400);
  }

  const { results: tracks } = await c.env.DB.prepare(
    `SELECT DISTINCT t.* FROM tracks t
     JOIN track_tags tt ON tt.track_id = t.id
     JOIN tags tg ON tg.id = tt.tag_id
     WHERE t.status = 'published' AND tg.name = ?`
  )
    .bind(mood)
    .all<Track>();

  if (tracks.length === 0) {
    return c.json({ session: null, message: `No published tracks tagged "${mood}" yet.` });
  }

  const { results: stationIds } = await c.env.DB.prepare(
    "SELECT * FROM audio_assets WHERE status = 'published' AND type IN ('station_id','jingle','promo')"
  ).all<AudioAsset>();

  const seedKey = `session:${mood}:${durationMinutes}:${Date.now()}`;
  const items = buildSession(seedKey, tracks, stationIds, durationMinutes * 60, await loadPinnedJingles(c.env.DB));
  const totalDurationSeconds = items.reduce((sum, i) => sum + i.duration_seconds, 0);

  // Songs never repeat, so a mood with little music tagged gives a session
  // shorter than asked for - say so rather than leave it looking like a bug.
  const shortBy = durationMinutes * 60 - totalDurationSeconds;
  const message =
    shortBy > 120
      ? `Only about ${Math.round(totalDurationSeconds / 60)} minutes of "${mood}" music is available right now, so this mix is shorter than the ${durationMinutes} you asked for.`
      : undefined;

  return c.json({
    session: { mood, duration_minutes: durationMinutes, total_duration_seconds: totalDurationSeconds, items },
    message,
  });
});

/**
 * "Radio That Knows You": what a listener can ask for, and the programme built
 * for one request. Stateless and rule-based (see buildProgramme) - nothing is
 * written per request and no AI is involved. The programme comes back in the
 * same shape as a Studio programme (a title plus ordered items, where spoken
 * links are item_type "link"), so the player treats it like any other.
 */
publicRoutes.get("/needs", (c) =>
  c.json({ needs: NEEDS.map((n) => ({ key: n.key, label: n.label, emoji: n.emoji, blurb: n.blurb })) })
);

publicRoutes.post("/radio-for-you", async (c) => {
  const body = await c.req
    .json<{ need?: string; songs?: number; band?: string }>()
    .catch(() => ({}) as { need?: string; songs?: number; band?: string });
  const need = findNeed(body.need);
  if (!need) return c.json({ error: `need must be one of ${NEED_KEYS.join(", ")}` }, 400);
  // 4 songs unless asked otherwise (a page from before this was song-based sends
  // `minutes` instead, which is ignored and so gets the default too).
  const songCount = Math.min(Math.max(Math.round(Number(body.songs) || 4), 3), 6);
  const band = ["morning", "afternoon", "evening", "night"].includes(String(body.band)) ? String(body.band) : null;

  const tracksWithTag = async (tags: string[]) =>
    (
      await c.env.DB.prepare(
        `SELECT DISTINCT t.* FROM tracks t
         JOIN track_tags tt ON tt.track_id = t.id
         JOIN tags tg ON tg.id = tt.tag_id
         WHERE t.status = 'published' AND tg.name IN (${tags.map(() => "?").join(",")})`
      )
        .bind(...tags)
        .all<Track>()
    ).results;

  const mainTracks = await tracksWithTag(need.tags_any);
  if (mainTracks.length === 0) {
    return c.json({ programme: null, message: "There isn't any music tagged for that yet - check back soon." });
  }
  const mainIds = new Set(mainTracks.map((t) => t.id));
  const wildcardTracks = (await tracksWithTag(need.wildcard_tags)).filter((t) => !mainIds.has(t.id));

  const { results: linkRows } = await c.env.DB.prepare(
    `SELECT aa.id, aa.title, aa.audio_url, aa.duration_seconds, aa.link_kind,
            (SELECT GROUP_CONCAT(tg.name) FROM audio_asset_tags aat
             JOIN tags tg ON tg.id = aat.tag_id WHERE aat.audio_asset_id = aa.id) AS tag_names
     FROM audio_assets aa
     WHERE aa.type = 'link' AND aa.status = 'published' AND aa.link_kind IS NOT NULL`
  ).all<Omit<LinkClip, "tags"> & { tag_names: string | null }>();
  const links: LinkClip[] = linkRows.map((r) => ({
    id: r.id,
    title: r.title,
    audio_url: r.audio_url,
    duration_seconds: r.duration_seconds,
    link_kind: r.link_kind,
    tags: r.tag_names ? r.tag_names.split(",") : [],
  }));

  const { results: stationIds } = await c.env.DB.prepare(
    "SELECT * FROM audio_assets WHERE status = 'published' AND type IN ('station_id','jingle','promo')"
  ).all<AudioAsset>();
  const { results: titles } = await c.env.DB.prepare(
    "SELECT title, time_band FROM programme_titles WHERE need = ?"
  )
    .bind(need.key)
    .all<ProgrammeTitle>();

  const built = buildProgramme({
    seedKey: `radio:${need.key}:${Date.now()}:${Math.random()}`,
    needKey: need.key,
    matchTags: [...need.tags_any, ...need.link_tags],
    mainTracks,
    wildcardTracks,
    links,
    stationIds,
    pins: await loadPinnedJingles(c.env.DB),
    titles,
    songCount,
    band,
  });

  return c.json({
    programme: {
      title: built.title,
      need: need.key,
      need_label: need.label,
      description: `${need.blurb} - ${songCount} songs`,
      song_count: songCount,
      total_duration_seconds: built.total_duration_seconds,
      wildcard_count: built.wildcard_count,
      link_count: built.link_count,
    },
    items: built.items,
  });
});

/**
 * Time Capsules: the public request form. No login, and deliberately NOT an
 * upload: a listener describes what they'd like said and on which date, and
 * Kizzi records or approves the audio in the Studio before anything is
 * scheduled - so nothing unreviewed can ever go out on air.
 *
 * Open, unauthenticated writes need guarding: a hidden field bots fill in,
 * a small per-visitor rate limit, hard length limits (see parseCapsuleFields),
 * and a ceiling on how many unanswered requests can pile up.
 */
publicRoutes.post("/time-capsules", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

  // A real person never sees this field; a form-filling bot does. Pretend it worked.
  if (String(body.website ?? "").trim() !== "") return c.json({ ok: true });

  const today = stationToday();
  const parsed = parseCapsuleFields(body, { earliest: addDays(today, 1), latest: addDays(today, 730) });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  // Per-visitor limit (a hash of the address, never the address itself).
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`capsule:${ip}`));
  const who = Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  const hourKey = `capsule-rate:${who}:h:${new Date().toISOString().slice(0, 13)}`;
  const dayKey = `capsule-rate:${who}:d:${new Date().toISOString().slice(0, 10)}`;
  const [hourCount, dayCount] = await Promise.all([c.env.CONFIG.get(hourKey), c.env.CONFIG.get(dayKey)]);
  if (Number(hourCount ?? 0) >= 3 || Number(dayCount ?? 0) >= 8) {
    return c.json({ error: "You've sent a few requests already - please try again a little later." }, 429);
  }

  const { results: open } = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM time_capsules WHERE status = 'requested'"
  ).all<{ n: number }>();
  if ((open[0]?.n ?? 0) >= 400) {
    return c.json({ error: "Time capsules are very busy right now - please try again soon." }, 503);
  }

  const v = parsed.value;
  const id = newId("cap");
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO time_capsules (id, requester_name, recipient_name, occasion_label, message_note, notify_email,
                                scheduled_date, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'requested', ?, ?)`
  )
    .bind(id, v.requester_name, v.recipient_name, v.occasion_label, v.message_note, v.notify_email, v.scheduled_date, ts, ts)
    .run();

  await Promise.all([
    c.env.CONFIG.put(hourKey, String(Number(hourCount ?? 0) + 1), { expirationTtl: 60 * 60 * 2 }),
    c.env.CONFIG.put(dayKey, String(Number(dayCount ?? 0) + 1), { expirationTtl: 60 * 60 * 26 }),
  ]);

  return c.json({ ok: true, scheduled_date: v.scheduled_date });
});

/**
 * Phase 3 (handoff_radio_brain_roadmap.md): when the main player switches
 * channel - a time-of-day boundary passing, or a listener using Vibe Shift
 * - this picks a jingle to sweep the transition with, so it feels like a
 * live broadcast handing over rather than an app switching screens.
 * Prefers a jingle/station ID/promo tagged with the given time band; falls
 * back to any published one of those types if none match that band (or no
 * band is given), and to nothing at all if none exist yet - the transition
 * just cuts silently rather than erroring.
 */
publicRoutes.get("/sweeper", async (c) => {
  const band = c.req.query("band");

  let asset = null;
  if (band) {
    asset = await c.env.DB.prepare(
      `SELECT aa.* FROM audio_assets aa
       JOIN audio_asset_tags aat ON aat.audio_asset_id = aa.id
       JOIN tags tg ON tg.id = aat.tag_id
       WHERE aa.status = 'published' AND aa.type IN ('jingle','station_id','promo') AND tg.name = ?
       ORDER BY RANDOM() LIMIT 1`
    )
      .bind(band)
      .first<AudioAsset>();
  }

  if (!asset) {
    asset = await c.env.DB.prepare(
      `SELECT * FROM audio_assets
       WHERE status = 'published' AND type IN ('jingle','station_id','promo')
       ORDER BY RANDOM() LIMIT 1`
    ).first<AudioAsset>();
  }

  return c.json({ asset });
});

publicRoutes.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ tracks: [], albums: [], programmes: [] });

  const like = `%${q}%`;

  const [tracks, albums, programmes] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, title, genre FROM tracks WHERE status='published' AND (title LIKE ? OR description LIKE ?) LIMIT 20"
    )
      .bind(like, like)
      .all(),
    c.env.DB.prepare("SELECT id, title, genre FROM albums WHERE title LIKE ? OR description LIKE ? LIMIT 20")
      .bind(like, like)
      .all(),
    c.env.DB.prepare(
      "SELECT id, title, channel_id FROM programmes WHERE status='published' AND (title LIKE ? OR description LIKE ?) LIMIT 20"
    )
      .bind(like, like)
      .all(),
  ]);

  return c.json({ tracks: tracks.results, albums: albums.results, programmes: programmes.results });
});
