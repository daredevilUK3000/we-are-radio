import { Hono } from "hono";
import type { Env, Programme, ProgrammeItem } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const programmeRoutes = new Hono<{ Bindings: Env }>();

programmeRoutes.get("/", async (c) => {
  const channelId = c.req.query("channel_id");
  const status = c.req.query("status");
  const flagship = c.req.query("is_flagship");

  let sql = "SELECT * FROM programmes WHERE 1=1";
  const params: unknown[] = [];
  if (channelId) {
    sql += " AND channel_id = ?";
    params.push(channelId);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (flagship === "1") {
    sql += " AND is_flagship = 1";
  }
  sql += " ORDER BY publish_date DESC, created_at DESC LIMIT 200";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<Programme>();
  return c.json({ programmes: results });
});

programmeRoutes.get("/:id", async (c) => {
  const programme = await c.env.DB.prepare("SELECT * FROM programmes WHERE id = ?")
    .bind(c.req.param("id"))
    .first<Programme>();
  if (!programme) return c.json({ error: "not found" }, 404);

  const { results: items } = await c.env.DB.prepare(
    `SELECT pi.*, t.title as track_title, t.duration_seconds as track_duration_seconds,
            aa.title as audio_asset_title, aa.duration_seconds as audio_asset_duration_seconds
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

programmeRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<Programme>>();
  if (!body.channel_id || !body.title) {
    return c.json({ error: "channel_id and title are required" }, 400);
  }
  const id = newId("prog");
  const ts = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO programmes (id, channel_id, title, description, artwork_url, episode_number,
       status, is_flagship, publish_date, duration_seconds, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      body.channel_id,
      body.title,
      body.description ?? null,
      body.artwork_url ?? null,
      body.episode_number ?? null,
      body.status ?? "draft",
      body.is_flagship ? 1 : 0,
      body.publish_date ?? null,
      body.duration_seconds ?? null,
      ts,
      ts
    )
    .run();

  return c.json({ id }, 201);
});

programmeRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(`UPDATE programmes SET ${setClause}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map((f) => body[f]), nowIso(), id)
    .run();

  return c.json({ ok: true });
});

// Replace the whole running order in one call - simplest model for a drag-reorder UI
// that submits its final order on save.
programmeRoutes.put("/:id/items", async (c) => {
  const programmeId = c.req.param("id");
  const { items } = await c.req.json<{
    items: Array<Pick<ProgrammeItem, "item_type" | "track_id" | "audio_asset_id" | "label">>;
  }>();

  const statements = [
    c.env.DB.prepare("DELETE FROM programme_items WHERE programme_id = ?").bind(programmeId),
  ];

  items.forEach((item, index) => {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO programme_items (id, programme_id, position, item_type, track_id, audio_asset_id, label)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        newId("pi"),
        programmeId,
        index,
        item.item_type,
        item.track_id ?? null,
        item.audio_asset_id ?? null,
        item.label ?? null
      )
    );
  });

  await c.env.DB.batch(statements);

  // Recompute total duration from tracks + audio_assets durations.
  const total = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(t.duration_seconds), 0) + COALESCE(SUM(aa.duration_seconds), 0) as total
     FROM programme_items pi
     LEFT JOIN tracks t ON t.id = pi.track_id
     LEFT JOIN audio_assets aa ON aa.id = pi.audio_asset_id
     WHERE pi.programme_id = ?`
  )
    .bind(programmeId)
    .first<{ total: number }>();

  await c.env.DB.prepare("UPDATE programmes SET duration_seconds = ?, updated_at = ? WHERE id = ?")
    .bind(total?.total ?? 0, nowIso(), programmeId)
    .run();

  return c.json({ ok: true, duration_seconds: total?.total ?? 0 });
});
