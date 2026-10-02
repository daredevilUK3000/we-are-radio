import { Hono } from "hono";
import type { Env, AudioAsset } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const audioAssetRoutes = new Hono<{ Bindings: Env }>();

audioAssetRoutes.get("/", async (c) => {
  const type = c.req.query("type");
  const storage = c.req.query("storage");
  let sql = `SELECT aa.*,
      (SELECT GROUP_CONCAT(tg.name) FROM audio_asset_tags aat
       JOIN tags tg ON tg.id = aat.tag_id WHERE aat.audio_asset_id = aa.id) as tag_names,
      (SELECT COUNT(*) FROM track_jingles tj WHERE tj.audio_asset_id = aa.id) as pin_count,
      (SELECT GROUP_CONCAT(t.title, '|') FROM track_jingles tj
       JOIN tracks t ON t.id = tj.track_id WHERE tj.audio_asset_id = aa.id) as pin_titles,
      (SELECT COUNT(*) FROM time_capsules tc WHERE tc.audio_asset_id = aa.id) as capsule_count
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
  // Listener voice notes ("Say it on air") would clutter the links library:
  // hidden by default, and the only thing shown with ?voices=1.
  const voices = "aa.id IN (SELECT audio_asset_id FROM onair_messages WHERE audio_asset_id IS NOT NULL)";
  sql += c.req.query("voices") === "1" ? ` AND ${voices}` : ` AND NOT ${voices}`;
  sql += " ORDER BY created_at DESC LIMIT 200";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<AudioAsset & { tag_names: string | null; pin_count: number; pin_titles: string | null; capsule_count: number }>();
  return c.json({ audio_assets: results });
});

const LINK_KINDS = ["intro", "transition", "fun_fact", "observation", "outro"];

audioAssetRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<AudioAsset>>();
  if (body.link_kind && !LINK_KINDS.includes(body.link_kind)) {
    return c.json({ error: `link_kind must be one of ${LINK_KINDS.join(", ")}` }, 400);
  }
  if (!body.type || !body.title || !body.audio_url || body.duration_seconds == null) {
    return c.json({ error: "type, title, audio_url and duration_seconds are required" }, 400);
  }
  const id = newId("aa");
  await c.env.DB.prepare(
    `INSERT INTO audio_assets (id, type, title, audio_url, duration_seconds, description, status, link_kind, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      body.type,
      body.title,
      body.audio_url,
      body.duration_seconds,
      body.description ?? null,
      // Jingles go live on upload unless a status is given explicitly.
      body.status ?? (["jingle", "station_id", "promo"].includes(body.type) ? "published" : "draft"),
      body.type === "link" ? body.link_kind ?? null : null,
      nowIso()
    )
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
  if ("link_kind" in body && body.link_kind !== null && !LINK_KINDS.includes(String(body.link_kind))) {
    return c.json({ error: `link_kind must be one of ${LINK_KINDS.join(", ")}` }, 400);
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

// Songs a jingle is pinned to: every time one of them plays, this jingle plays
// over it, `start_offset_seconds` in.
audioAssetRoutes.get("/:id/pins", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT tj.track_id, tj.start_offset_seconds, t.title
     FROM track_jingles tj JOIN tracks t ON t.id = tj.track_id
     WHERE tj.audio_asset_id = ?
     ORDER BY t.title ASC`
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ pins: results });
});

// Replaces the whole set of songs this jingle is pinned to.
audioAssetRoutes.put("/:id/pins", async (c) => {
  const id = c.req.param("id");
  const { pins } = await c.req.json<{ pins?: Array<{ track_id: string; start_offset_seconds: number }> }>();
  if (!Array.isArray(pins) || pins.length > 60) return c.json({ error: "pins must be a list of at most 60" }, 400);

  const seen = new Set<string>();
  for (const pin of pins) {
    const offset = Number(pin.start_offset_seconds);
    if (!pin.track_id || !Number.isFinite(offset) || offset < 0 || offset > 900) {
      return c.json({ error: "each pin needs a track and a start time between 0 and 900 seconds" }, 400);
    }
    if (seen.has(pin.track_id)) return c.json({ error: "a song can only be pinned once per jingle" }, 400);
    seen.add(pin.track_id);
  }

  const asset = await c.env.DB.prepare("SELECT id FROM audio_assets WHERE id = ?").bind(id).first();
  if (!asset) return c.json({ error: "not found" }, 404);

  const statements = [c.env.DB.prepare("DELETE FROM track_jingles WHERE audio_asset_id = ?").bind(id)];
  const ts = nowIso();
  for (const pin of pins) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO track_jingles (id, track_id, audio_asset_id, start_offset_seconds, created_at)
         SELECT ?, t.id, ?, ?, ? FROM tracks t WHERE t.id = ?`
      ).bind(newId("tj"), id, Math.round(Number(pin.start_offset_seconds)), ts, pin.track_id)
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

// ---- Advertising For Good (migrations/0022) ----
//
// AFG ads are ordinary jingles with afg = 1: they air exactly as before, and
// these routes only manage how they appear on the site (/good, the landing
// page). The listener-facing list is GET /api/good (routes/public.ts).

const AFG_CAUSE_KEY = "afg:cause_enabled";

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ad"
  );
}

// A slug nobody else has: "be-kind", then "be-kind-2", ...
async function freeSlug(db: D1Database, title: string, selfId: string): Promise<string> {
  const base = slugify(title);
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await db.prepare("SELECT id FROM audio_assets WHERE afg_slug = ? AND id != ?").bind(slug, selfId).first();
    if (!taken) return slug;
  }
  return `${base}-${selfId.slice(-6)}`;
}

// Every AFG ad in display order (on the site or not), with the cause switch.
audioAssetRoutes.get("/afg", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT aa.id, aa.title, aa.audio_url, aa.duration_seconds, aa.status, aa.afg_slug, aa.afg_order,
            aa.afg_featured, aa.afg_published,
            (SELECT COUNT(*) FROM afg_preview_events e WHERE e.audio_asset_id = aa.id
              AND e.timestamp >= datetime('now', '-30 days')) AS previews_30d
     FROM audio_assets aa WHERE aa.afg = 1
     ORDER BY aa.afg_order IS NULL, aa.afg_order ASC, aa.created_at ASC`
  ).all();
  const cause = (await c.env.CONFIG.get(AFG_CAUSE_KEY)) === "1";
  return c.json({ ads: results, cause_enabled: cause });
});

audioAssetRoutes.put("/afg/settings", async (c) => {
  const body = await c.req.json<{ cause_enabled?: boolean }>().catch(() => ({}) as { cause_enabled?: boolean });
  if (typeof body.cause_enabled !== "boolean") return c.json({ error: "cause_enabled must be true or false" }, 400);
  await c.env.CONFIG.put(AFG_CAUSE_KEY, body.cause_enabled ? "1" : "0");
  return c.json({ ok: true });
});

// The whole display order at once: ids in the order they should appear.
audioAssetRoutes.put("/afg/order", async (c) => {
  const { ids } = await c.req.json<{ ids?: string[] }>().catch(() => ({}) as { ids?: string[] });
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || ids.some((id) => typeof id !== "string")) {
    return c.json({ error: "ids must be a list of ad ids" }, 400);
  }
  await c.env.DB.batch(
    ids.map((id, i) => c.env.DB.prepare("UPDATE audio_assets SET afg_order = ? WHERE id = ? AND afg = 1").bind(i + 1, id))
  );
  return c.json({ ok: true });
});

// Mark or unmark as AFG, retitle, or show/hide on the site.
// Marking gives it a link (kept from before if it had one), puts it last, and
// shows it on the site straight away.
audioAssetRoutes.patch("/:id/afg", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ afg?: boolean; title?: string; afg_published?: boolean }>()
    .catch(() => ({}) as { afg?: boolean; title?: string; afg_published?: boolean });
  const asset = await c.env.DB.prepare("SELECT id, type, title, afg, afg_slug FROM audio_assets WHERE id = ?")
    .bind(id)
    .first<{ id: string; type: string; title: string; afg: number; afg_slug: string | null }>();
  if (!asset) return c.json({ error: "not found" }, 404);

  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title || title.length > 80) return c.json({ error: "A title is needed, up to 80 characters." }, 400);
    await c.env.DB.prepare("UPDATE audio_assets SET title = ? WHERE id = ?").bind(title, id).run();
    asset.title = title;
  }

  if (body.afg === true && !asset.afg) {
    if (!["jingle", "station_id", "promo"].includes(asset.type)) {
      return c.json({ error: "Only jingles, station IDs and promos can be Advertising For Good." }, 400);
    }
    const slug = asset.afg_slug ?? (await freeSlug(c.env.DB, asset.title, id));
    const last = await c.env.DB.prepare("SELECT MAX(afg_order) AS n FROM audio_assets WHERE afg = 1").first<{ n: number | null }>();
    await c.env.DB.prepare("UPDATE audio_assets SET afg = 1, afg_slug = ?, afg_order = ?, afg_published = 1 WHERE id = ?")
      .bind(slug, (last?.n ?? 0) + 1, id)
      .run();
  } else if (body.afg === false && asset.afg) {
    // The slug is kept, so marking it again later brings the same link back.
    await c.env.DB.prepare("UPDATE audio_assets SET afg = 0, afg_published = 0, afg_featured = 0, afg_order = NULL WHERE id = ?")
      .bind(id)
      .run();
  }

  if (typeof body.afg_published === "boolean") {
    await c.env.DB.prepare("UPDATE audio_assets SET afg_published = ? WHERE id = ? AND afg = 1")
      .bind(body.afg_published ? 1 : 0, id)
      .run();
  }
  return c.json({ ok: true });
});

// Make this the featured ad (the landing page's "Hear one" player).
audioAssetRoutes.post("/:id/afg/feature", async (c) => {
  const id = c.req.param("id");
  const asset = await c.env.DB.prepare("SELECT id FROM audio_assets WHERE id = ? AND afg = 1").bind(id).first();
  if (!asset) return c.json({ error: "not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE audio_assets SET afg_featured = 0 WHERE afg_featured = 1"),
    c.env.DB.prepare("UPDATE audio_assets SET afg_featured = 1 WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});
