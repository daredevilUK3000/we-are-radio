import { Hono } from "hono";
import type { Env, Track } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const trackRoutes = new Hono<{ Bindings: Env }>();

// GET /api/tracks?status=published&album_id=...&q=...
trackRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const albumId = c.req.query("album_id");
  const q = c.req.query("q");

  // album title and tag names come along so the Studio can list and edit
  // hundreds of tracks (a bulk import) without a request per row.
  let sql = `SELECT t.*, a.title AS album_title,
      (SELECT GROUP_CONCAT(tg.name) FROM track_tags tt
       JOIN tags tg ON tg.id = tt.tag_id WHERE tt.track_id = t.id) AS tag_names
    FROM tracks t LEFT JOIN albums a ON a.id = t.album_id WHERE 1=1`;
  const params: unknown[] = [];
  if (status) {
    sql += " AND t.status = ?";
    params.push(status);
  }
  if (albumId) {
    sql += " AND t.album_id = ?";
    params.push(albumId);
  }
  if (q) {
    sql += " AND t.title LIKE ?";
    params.push(`%${q}%`);
  }
  sql += " ORDER BY t.created_at DESC LIMIT 2000";

  const { results } = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<Track & { album_title: string | null; tag_names: string | null }>();
  return c.json({ tracks: results });
});

trackRoutes.get("/:id", async (c) => {
  const track = await c.env.DB.prepare("SELECT * FROM tracks WHERE id = ?")
    .bind(c.req.param("id"))
    .first<Track>();
  if (!track) return c.json({ error: "not found" }, 404);

  const { results: tags } = await c.env.DB.prepare(
    `SELECT t.id, t.name FROM tags t
     JOIN track_tags tt ON tt.tag_id = t.id
     WHERE tt.track_id = ?`
  )
    .bind(track.id)
    .all();

  return c.json({ track, tags });
});

// Studio-only: create/update/tag tracks. Mounted behind requireStudioAuth in index.ts.
trackRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<Track>>();
  if (!body.title || body.duration_seconds == null || !body.audio_url) {
    return c.json({ error: "title, duration_seconds and audio_url are required" }, 400);
  }
  const id = newId("trk");
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO tracks (
      id, title, artist, content_hash, album_id, track_number, duration_seconds, audio_url, artwork_url,
      genre, subgenre, energy, tempo_bpm, musical_key, vocal_or_instrumental,
      explicit, description, status, release_date, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      body.title,
      body.artist ?? null,
      body.content_hash ?? null,
      body.album_id ?? null,
      body.track_number ?? null,
      body.duration_seconds,
      body.audio_url,
      body.artwork_url ?? null,
      body.genre ?? null,
      body.subgenre ?? null,
      body.energy ?? null,
      body.tempo_bpm ?? null,
      body.musical_key ?? null,
      body.vocal_or_instrumental ?? null,
      body.explicit ? 1 : 0,
      body.description ?? null,
      body.status ?? "draft",
      body.release_date ?? null,
      ts,
      ts
    )
    .run();

  return c.json({ id }, 201);
});

trackRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<Track>>();

  const fields = Object.keys(body).filter((k) => k !== "id");
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => (body as Record<string, unknown>)[f]);

  await c.env.DB.prepare(`UPDATE tracks SET ${setClause}, updated_at = ? WHERE id = ?`)
    .bind(...values, nowIso(), id)
    .run();

  return c.json({ ok: true });
});

trackRoutes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM tracks WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// Tagging
trackRoutes.put("/:id/tags", async (c) => {
  const trackId = c.req.param("id");
  const { tags } = await c.req.json<{ tags: string[] }>();

  await c.env.DB.prepare("DELETE FROM track_tags WHERE track_id = ?").bind(trackId).run();

  for (const name of tags) {
    const tagId = newId("tag");
    await c.env.DB.prepare(
      "INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING"
    )
      .bind(tagId, name)
      .run();
    const tag = await c.env.DB.prepare("SELECT id FROM tags WHERE name = ?")
      .bind(name)
      .first<{ id: string }>();
    if (tag) {
      await c.env.DB.prepare(
        "INSERT INTO track_tags (track_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
      )
        .bind(trackId, tag.id)
        .run();
    }
  }

  return c.json({ ok: true });
});
