import { Hono } from "hono";
import type { Env, Programme, Channel, Track, AudioAsset } from "../lib/types";
import { buildRotation, locateInLoop, type RotationItem } from "../lib/radioBrain";

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

  const items: RotationItem[] = rows.map((row) => ({
    id: row.id,
    item_type: row.item_type,
    label: row.label ?? row.track_title ?? row.audio_asset_title,
    track_id: row.track_id,
    audio_asset_id: row.audio_asset_id,
    duration_seconds: row.track_duration_seconds ?? row.audio_asset_duration_seconds ?? 0,
    audio_url: row.track_audio_url ?? row.audio_asset_audio_url,
    artwork_url: row.track_artwork_url,
  }));
  const publishedAt = programme.publish_date ? new Date(programme.publish_date).getTime() : Date.now();
  const elapsed = Math.floor(((Date.now() - publishedAt) / 1000) % programme.duration_seconds);
  const { currentIndex, position_seconds } = locateInLoop(items, elapsed);

  return c.json({
    channel,
    programme,
    on_air: true,
    position_seconds,
    now_playing: items[currentIndex],
    up_next: items[currentIndex + 1] ? items[currentIndex + 1] : null,
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
  const cacheKey = `radio-brain:${seedKey}`;

  let items = await kv.get<RotationItem[]>(cacheKey, "json");
  if (!items) {
    items = buildRotation(seedKey, tracks, stationIds);
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
    now_playing: items[currentIndex],
    up_next: items[currentIndex + 1] ? items[currentIndex + 1] : null,
  };
}

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
