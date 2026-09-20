import { Hono } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { NEED_KEYS } from "../lib/needs";

/**
 * The bank of programme names for "Radio That Knows You": each request gets one
 * picked by rule from the titles written for its need (and, if it has a time of
 * day, preferably one for the listener's time of day).
 */
export const programmeTitleRoutes = new Hono<{ Bindings: Env }>();

const BANDS = ["morning", "afternoon", "evening", "night"];

programmeTitleRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM programme_titles ORDER BY need ASC, created_at ASC"
  ).all();
  return c.json({ titles: results });
});

programmeTitleRoutes.post("/", async (c) => {
  const body = await c.req.json<{ need?: string; title?: string; time_band?: string | null }>();
  const title = body.title?.trim();
  if (!body.need || !NEED_KEYS.includes(body.need)) return c.json({ error: `need must be one of ${NEED_KEYS.join(", ")}` }, 400);
  if (!title) return c.json({ error: "title is required" }, 400);
  if (body.time_band && !BANDS.includes(body.time_band)) return c.json({ error: "invalid time_band" }, 400);

  const id = newId("pt");
  await c.env.DB.prepare(
    "INSERT INTO programme_titles (id, need, title, time_band, created_at) VALUES (?,?,?,?,?)"
  )
    .bind(id, body.need, title, body.time_band || null, nowIso())
    .run();
  return c.json({ id }, 201);
});

programmeTitleRoutes.patch("/:id", async (c) => {
  const body = await c.req.json<{ need?: string; title?: string; time_band?: string | null }>();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.title !== undefined) {
    if (!body.title.trim()) return c.json({ error: "title can't be empty" }, 400);
    sets.push("title = ?");
    values.push(body.title.trim());
  }
  if (body.need !== undefined) {
    if (!NEED_KEYS.includes(body.need)) return c.json({ error: "invalid need" }, 400);
    sets.push("need = ?");
    values.push(body.need);
  }
  if ("time_band" in body) {
    if (body.time_band && !BANDS.includes(body.time_band)) return c.json({ error: "invalid time_band" }, 400);
    sets.push("time_band = ?");
    values.push(body.time_band || null);
  }
  if (sets.length === 0) return c.json({ error: "nothing to update" }, 400);
  await c.env.DB.prepare(`UPDATE programme_titles SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

programmeTitleRoutes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM programme_titles WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
