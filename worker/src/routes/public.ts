import { Hono } from "hono";
import type { Env, Programme } from "../lib/types";

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
 * pick the current on-air programme for a live channel and deterministically
 * compute *where in it* a listener joining right now would be, looping the
 * programme once it finishes. That's enough to make "Listen Now" feel live.
 */
publicRoutes.get("/now-playing", async (c) => {
  const channelSlug = c.req.query("channel") ?? "kizzi-radio";

  const channel = await c.env.DB.prepare(
    "SELECT * FROM channels WHERE slug = ? AND status = 'live'"
  )
    .bind(channelSlug)
    .first();
  if (!channel) return c.json({ error: "channel not found or not live" }, 404);

  const programme = await c.env.DB.prepare(
    `SELECT * FROM programmes
     WHERE channel_id = ? AND status = 'published'
     ORDER BY is_flagship DESC, publish_date DESC
     LIMIT 1`
  )
    .bind(channel.id as string)
    .first<Programme>();

  if (!programme || !programme.duration_seconds) {
    return c.json({ channel, on_air: false });
  }

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
    .all<ItemRow>();

  if (items.length === 0) {
    return c.json({ channel, programme, on_air: false });
  }

  const publishedAt = programme.publish_date ? new Date(programme.publish_date).getTime() : Date.now();
  const elapsed = Math.floor(((Date.now() - publishedAt) / 1000) % programme.duration_seconds);

  let cursor = 0;
  let currentIndex = 0;
  for (let i = 0; i < items.length; i++) {
    const duration = items[i].track_duration_seconds ?? items[i].audio_asset_duration_seconds ?? 0;
    if (elapsed < cursor + duration) {
      currentIndex = i;
      break;
    }
    cursor += duration;
    currentIndex = i;
  }

  const toPayload = (row: ItemRow) => ({
    id: row.id,
    item_type: row.item_type,
    label: row.label ?? row.track_title ?? row.audio_asset_title,
    track_id: row.track_id,
    audio_asset_id: row.audio_asset_id,
    duration_seconds: row.track_duration_seconds ?? row.audio_asset_duration_seconds ?? 0,
    audio_url: row.track_audio_url ?? row.audio_asset_audio_url,
    artwork_url: row.track_artwork_url,
  });

  return c.json({
    channel,
    programme,
    on_air: true,
    position_seconds: elapsed - cursor,
    now_playing: toPayload(items[currentIndex]),
    up_next: items[currentIndex + 1] ? toPayload(items[currentIndex + 1]) : null,
  });
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
