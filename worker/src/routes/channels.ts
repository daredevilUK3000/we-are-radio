import { Hono } from "hono";
import type { Env, Channel } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const channelRoutes = new Hono<{ Bindings: Env }>();

// Public listing only returns `live` channels unless ?all=1 (studio use).
channelRoutes.get("/", async (c) => {
  const includeAll = c.req.query("all") === "1";
  const sql = includeAll
    ? "SELECT * FROM channels ORDER BY created_at ASC"
    : "SELECT * FROM channels WHERE status = 'live' ORDER BY created_at ASC";
  const { results } = await c.env.DB.prepare(sql).all<Channel>();
  return c.json({ channels: results });
});

channelRoutes.get("/:idOrSlug", async (c) => {
  const idOrSlug = c.req.param("idOrSlug");
  const channel = await c.env.DB.prepare(
    "SELECT * FROM channels WHERE id = ? OR slug = ?"
  )
    .bind(idOrSlug, idOrSlug)
    .first<Channel>();
  if (!channel) return c.json({ error: "not found" }, 404);
  return c.json({ channel });
});

channelRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<Channel>>();
  if (!body.slug || !body.name) return c.json({ error: "slug and name are required" }, 400);

  const id = newId("ch");
  await c.env.DB.prepare(
    `INSERT INTO channels (id, slug, name, emoji, description, artwork_url, status, catalogue_rules, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      body.slug,
      body.name,
      body.emoji ?? null,
      body.description ?? null,
      body.artwork_url ?? null,
      body.status ?? "building",
      body.catalogue_rules ?? null,
      nowIso()
    )
    .run();

  return c.json({ id }, 201);
});

channelRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const fields = Object.keys(body);
  if (fields.length === 0) return c.json({ error: "no fields to update" }, 400);

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(`UPDATE channels SET ${setClause} WHERE id = ?`)
    .bind(...fields.map((f) => body[f]), id)
    .run();

  return c.json({ ok: true });
});

// One explicit action to flip building <-> live (Section 10).
channelRoutes.post("/:id/status", async (c) => {
  const id = c.req.param("id");
  const { status } = await c.req.json<{ status: "building" | "live" }>();
  if (status !== "building" && status !== "live") {
    return c.json({ error: "status must be 'building' or 'live'" }, 400);
  }
  await c.env.DB.prepare("UPDATE channels SET status = ? WHERE id = ?").bind(status, id).run();
  return c.json({ ok: true });
});

// Lightweight advisory checklist before going live - a nudge, not a hard gate.
channelRoutes.get("/:id/launch-checklist", async (c) => {
  const id = c.req.param("id");
  const channel = await c.env.DB.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<Channel>();
  if (!channel) return c.json({ error: "not found" }, 404);

  let taggedTrackCount = 0;
  try {
    const rules = channel.catalogue_rules ? JSON.parse(channel.catalogue_rules) : null;
    if (rules?.tags_any?.length) {
      const placeholders = rules.tags_any.map(() => "?").join(",");
      const row = await c.env.DB.prepare(
        `SELECT COUNT(DISTINCT tt.track_id) as n FROM track_tags tt
         JOIN tags t ON t.id = tt.tag_id
         WHERE t.name IN (${placeholders})`
      )
        .bind(...rules.tags_any)
        .first<{ n: number }>();
      taggedTrackCount = row?.n ?? 0;
    }
  } catch {
    // malformed catalogue_rules - checklist just reports 0, doesn't block anything
  }

  const spokenContentCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM audio_assets WHERE status = 'published'"
  ).first<{ n: number }>();

  return c.json({
    checklist: {
      has_artwork: Boolean(channel.artwork_url),
      has_matching_tracks: taggedTrackCount > 0,
      matching_track_count: taggedTrackCount,
      has_published_spoken_content: (spokenContentCount?.n ?? 0) > 0,
    },
  });
});
