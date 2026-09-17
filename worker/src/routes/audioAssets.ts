import { Hono } from "hono";
import type { Env, AudioAsset } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const audioAssetRoutes = new Hono<{ Bindings: Env }>();

audioAssetRoutes.get("/", async (c) => {
  const type = c.req.query("type");
  let sql = "SELECT * FROM audio_assets WHERE 1=1";
  const params: unknown[] = [];
  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<AudioAsset>();
  return c.json({ audio_assets: results });
});

audioAssetRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<AudioAsset>>();
  if (!body.type || !body.title || !body.audio_url || body.duration_seconds == null) {
    return c.json({ error: "type, title, audio_url and duration_seconds are required" }, 400);
  }
  const id = newId("aa");
  await c.env.DB.prepare(
    `INSERT INTO audio_assets (id, type, title, audio_url, duration_seconds, description, status, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  )
    .bind(id, body.type, body.title, body.audio_url, body.duration_seconds, body.description ?? null, body.status ?? "draft", nowIso())
    .run();

  return c.json({ id }, 201);
});

audioAssetRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(`UPDATE audio_assets SET ${setClause} WHERE id = ?`)
    .bind(...fields.map((f) => body[f]), id)
    .run();

  return c.json({ ok: true });
});
