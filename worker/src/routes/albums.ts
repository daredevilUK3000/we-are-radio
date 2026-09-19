import { Hono } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const albumRoutes = new Hono<{ Bindings: Env }>();

albumRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM albums ORDER BY release_date DESC, created_at DESC"
  ).all();
  return c.json({ albums: results });
});

albumRoutes.get("/:id", async (c) => {
  const album = await c.env.DB.prepare("SELECT * FROM albums WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!album) return c.json({ error: "not found" }, 404);

  const { results: tracks } = await c.env.DB.prepare(
    "SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number ASC"
  )
    .bind(album.id as string)
    .all();

  return c.json({ album, tracks });
});

albumRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    title: string;
    description?: string;
    artwork_url?: string;
    release_date?: string;
    genre?: string;
  }>();
  if (!body.title) return c.json({ error: "title is required" }, 400);

  const id = newId("alb");
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO albums (id, title, description, artwork_url, release_date, genre, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  )
    .bind(id, body.title, body.description ?? null, body.artwork_url ?? null, body.release_date ?? null, body.genre ?? null, ts, ts)
    .run();

  return c.json({ id }, 201);
});

// Which album the homepage showcases (handoff_landing_page_lower_half.md).
// At most one album is ever featured, so featuring one clears the rest in
// the same batch; unfeaturing just clears it.
albumRoutes.post("/:id/feature", async (c) => {
  const id = c.req.param("id");
  const { featured } = await c.req.json<{ featured: boolean }>();

  if (featured) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE albums SET is_featured = 0 WHERE is_featured = 1"),
      c.env.DB.prepare("UPDATE albums SET is_featured = 1, updated_at = ? WHERE id = ?").bind(nowIso(), id),
    ]);
  } else {
    await c.env.DB.prepare("UPDATE albums SET is_featured = 0, updated_at = ? WHERE id = ?").bind(nowIso(), id).run();
  }
  return c.json({ ok: true });
});

albumRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(`UPDATE albums SET ${setClause}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map((f) => body[f]), nowIso(), id)
    .run();

  return c.json({ ok: true });
});
