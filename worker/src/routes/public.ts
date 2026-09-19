import { Hono } from "hono";
import type { Env, Programme, Channel, Track, AudioAsset } from "../lib/types";
import {
  buildRotation,
  buildSession,
  hashSeed,
  locateInLoop,
  withPinnedJingles,
  type PinnedJingle,
  type RotationItem,
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

  return c.json({ album, tracks });
});

publicRoutes.get("/tracks", async (c) => {
  const q = c.req.query("q");
  let sql = "SELECT * FROM tracks WHERE status = 'published'";
  const params: unknown[] = [];
  if (q) {
    sql += " AND title LIKE ?";
    params.push(`%${q}%`);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ tracks: results });
});

publicRoutes.get("/tracks/:id", async (c) => {
  const track = await c.env.DB.prepare("SELECT * FROM tracks WHERE id = ? AND status = 'published'")
    .bind(c.req.param("id"))
    .first();
  if (!track) return c.json({ error: "not found" }, 404);

  const { results: tags } = await c.env.DB.prepare(
    `SELECT tg.id, tg.name FROM tags tg
     JOIN track_tags tt ON tt.tag_id = tg.id
     WHERE tt.track_id = ?`
  )
    .bind(track.id as string)
    .all();

  return c.json({ track, tags });
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

  return c.json({ programme, items });
});

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
 * catalogue - useful for a flagship channel running autopilot with no
 * programme ready yet), plus any published station IDs/jingles. That
 * rotation is cached in KV, keyed on the channel and exactly which
 * tracks/assets currently qualify - so it's stable between requests but
 * regenerates itself the moment Kizzi tags a new track into the pool,
 * without a cron job or a "last generated" timestamp to manage.
 */
publicRoutes.get("/now-playing", async (c) => {
  const channelSlug = c.req.query("channel") ?? "kizzi-radio";

  const channel = await c.env.DB.prepare(
    "SELECT * FROM channels WHERE slug = ? AND status = 'live'"
  )
    .bind(channelSlug)
    .first<Channel>();
  if (!channel) return c.json({ error: "channel not found or not live" }, 404);

  if (channel.programming_mode === "autopilot") {
    return c.json(await nowPlayingAutopilot(c.env.DB, c.env.CONFIG, channel));
  }

  const programme = await c.env.DB.prepare(
    `SELECT * FROM programmes
     WHERE channel_id = ? AND status = 'published'
     ORDER BY is_flagship DESC, publish_date DESC
     LIMIT 1`
  )
    .bind(channel.id)
    .first<Programme>();

  if (!programme || !programme.duration_seconds) {
    return c.json({ channel, on_air: false });
  }

  const { results: rows } = await c.env.DB.prepare(
    `SELECT pi.*, t.title as track_title, t.duration_seconds as track_duration_seconds, t.audio_url as track_audio_url, t.artwork_url as track_artwork_url,
            aa.title as audio_asset_title, aa.duration_seconds as audio_asset_duration_seconds, aa.audio_url as audio_asset_audio_url
     FROM programme_items pi
     LEFT JOIN tracks t ON t.id = pi.track_id
     LEFT JOIN audio_assets aa ON aa.id = pi.audio_asset_id
     WHERE pi.programme_id = ?
     ORDER BY pi.position ASC`
  )
    .bind(programme.id)
    .all<ItemRow>();

  if (rows.length === 0) {
    return c.json({ channel, programme, on_air: false });
  }

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
  const items = withPinnedJingles(baseItems, await loadPinnedJingles(c.env.DB));
  const publishedAt = programme.publish_date ? new Date(programme.publish_date).getTime() : Date.now();
  const elapsed = Math.floor(((Date.now() - publishedAt) / 1000) % programme.duration_seconds);
  const { currentIndex, position_seconds } = locateInLoop(items, elapsed);

  return c.json({
    channel,
    programme,
    on_air: true,
    position_seconds,
    ...(await describePlayback(c.env.DB, items, currentIndex)),
  });
});

async function nowPlayingAutopilot(db: D1Database, kv: KVNamespace, channel: Channel) {
  const rules = channel.catalogue_rules ? JSON.parse(channel.catalogue_rules) : null;
  const tagsAny: string[] = rules?.tags_any ?? [];

  const tracks =
    tagsAny.length > 0
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

  const { results: stationIds } = await db
    .prepare("SELECT * FROM audio_assets WHERE status = 'published' AND type IN ('station_id','jingle','promo')")
    .all<AudioAsset>();

  if (tracks.length === 0) {
    return { channel, on_air: false };
  }

  // The cache/seed key is fingerprinted on exactly which tracks and station
  // IDs currently qualify, not a timestamp - so the rotation is stable
  // between requests but regenerates itself the instant the pool changes.
  const fingerprint = [
    tracks.map((t) => t.id).sort().join(","),
    stationIds.map((a) => a.id).sort().join(","),
  ].join("|");
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
  const pinsConfig = pins
    .map((p) => `${p.track_id}>${p.asset_id}@${p.start_offset_seconds}:${p.duck_level}:${p.duck_fade_ms}`)
    .sort()
    .join(",");
  const cacheKey = `radio-brain:${channel.id}:${hashSeed(fingerprint + "|" + playbackConfig + "|" + pinsConfig)}`;

  let items = await kv.get<RotationItem[]>(cacheKey, "json");
  if (!items) {
    items = buildRotation(seedKey, tracks, stationIds, pins);
    await kv.put(cacheKey, JSON.stringify(items), { expirationTtl: 60 * 60 * 24 * 30 });
  }

  const totalDuration = items.reduce((sum, i) => sum + i.duration_seconds, 0);
  if (items.length === 0 || totalDuration === 0) {
    return { channel, on_air: false };
  }

  const elapsed = Math.floor((Date.now() / 1000) % totalDuration);
  const { currentIndex, position_seconds } = locateInLoop(items, elapsed);

  return {
    channel,
    programme: { id: null, title: channel.name, description: channel.description },
    on_air: true,
    position_seconds,
    ...(await describePlayback(db, items, currentIndex)),
  };
}

/**
 * What the Now Playing screen needs beyond "the current item": the next few
 * things on air (so the listener sees the flow of the station, not one track),
 * and for songs the album they belong to and its artwork as a fallback.
 * Station IDs are left out of the queue - listeners care about the songs and
 * talk, not that a jingle is coming.
 */
async function describePlayback(db: D1Database, items: RotationItem[], currentIndex: number) {
  const now = items[currentIndex];
  const upNext = items[currentIndex + 1] ?? null;

  const comingUp: RotationItem[] = [];
  for (let step = 1; step < items.length && comingUp.length < 3; step++) {
    const item = items[(currentIndex + step) % items.length];
    if (item.item_type !== "station_id" && item.id !== now.id) comingUp.push(item);
  }

  const trackIds = Array.from(
    new Set([now, upNext, ...comingUp].map((i) => i?.track_id).filter((id): id is string => !!id))
  );
  const albumByTrack = new Map<string, { album_id: string | null; album_title: string | null; album_artwork_url: string | null }>();
  if (trackIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT t.id, t.album_id, a.title AS album_title, a.artwork_url AS album_artwork_url
         FROM tracks t LEFT JOIN albums a ON a.id = t.album_id
         WHERE t.id IN (${trackIds.map(() => "?").join(",")})`
      )
      .bind(...trackIds)
      .all<{ id: string; album_id: string | null; album_title: string | null; album_artwork_url: string | null }>();
    for (const row of results) albumByTrack.set(row.id, row);
  }

  const enrich = (item: RotationItem | null): RotationItem | null => {
    if (!item) return null;
    const album = item.track_id ? albumByTrack.get(item.track_id) : undefined;
    return {
      ...item,
      album_id: album?.album_id ?? null,
      album_title: album?.album_title ?? null,
      artwork_url: item.artwork_url ?? album?.album_artwork_url ?? null,
    };
  };

  return {
    now_playing: enrich(now),
    up_next: enrich(upNext),
    coming_up: comingUp.map((i) => enrich(i)),
  };
}

// Jingles pinned to specific songs (published jingles only).
async function loadPinnedJingles(db: D1Database): Promise<PinnedJingle[]> {
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
