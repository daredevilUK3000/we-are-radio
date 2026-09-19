import { Hono } from "hono";
import type { Env, AudioAsset } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const audioAssetRoutes = new Hono<{ Bindings: Env }>();

audioAssetRoutes.get("/", async (c) => {
  const type = c.req.query("type");
  const storage = c.req.query("storage");
  let sql = `SELECT aa.*,
      (SELECT GROUP_CONCAT(tg.name) FROM audio_asset_tags aat
       JOIN tags tg ON tg.id = aat.tag_id WHERE aat.audio_asset_id = aa.id) as tag_names
    FROM audio_assets aa WHERE 1=1`;
  const params: unknown[] = [];
  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }
  // 'r2' = files uploaded through the Studio; 'external' = podcast episodes
  // imported from a feed (they have their own Podcasts page).
  if (storage === "r2" || storage === "external") {
    sql += " AND storage = ?";
    params.push(storage);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<AudioAsset & { tag_names: string | null }>();
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

// Tagging - mirrors trackRoutes' PUT /:id/tags, so jingles/station IDs can
// be found by time band ("morning", "night", ...) the same way tracks are
// found by mood (Phase 3: handoff_radio_brain_roadmap.md).
audioAssetRoutes.put("/:id/tags", async (c) => {
  const assetId = c.req.param("id");
  const { tags } = await c.req.json<{ tags: string[] }>();

  await c.env.DB.prepare("DELETE FROM audio_asset_tags WHERE audio_asset_id = ?").bind(assetId).run();

  for (const name of tags) {
    const tagId = newId("tag");
    await c.env.DB.prepare("INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
      .bind(tagId, name)
      .run();
    const tag = await c.env.DB.prepare("SELECT id FROM tags WHERE name = ?").bind(name).first<{ id: string }>();
    if (tag) {
      await c.env.DB.prepare(
        "INSERT INTO audio_asset_tags (audio_asset_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
      )
        .bind(assetId, tag.id)
        .run();
    }
  }

  return c.json({ ok: true });
});

audioAssetRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  // Jingle playback settings: reject nonsense rather than store it (a 0
  // duck level would mute the music, a huge fade would never finish).
  if ("play_mode" in body && body.play_mode !== "sequenced" && body.play_mode !== "duck_over_music") {
    return c.json({ error: "play_mode must be 'sequenced' or 'duck_over_music'" }, 400);
  }
  if ("duck_level" in body) {
    const v = Number(body.duck_level);
    if (!Number.isFinite(v) || v < 0.05 || v > 0.9) return c.json({ error: "duck_level must be between 0.05 and 0.9" }, 400);
    body.duck_level = v;
  }
  if ("duck_fade_ms" in body) {
    const v = Math.round(Number(body.duck_fade_ms));
    if (!Number.isFinite(v) || v < 50 || v > 3000) return c.json({ error: "duck_fade_ms must be between 50 and 3000" }, 400);
    body.duck_fade_ms = v;
  }

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(`UPDATE audio_assets SET ${setClause} WHERE id = ?`)
    .bind(...fields.map((f) => body[f]), id)
    .run();

  return c.json({ ok: true });
});
