import { Hono } from "hono";
import type { Env, Channel } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { autopilotTracks, channelAlbums, channelTags } from "../lib/station";
import { enableOnGoLive } from "./scheduler";

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

const listParam = (v: string | undefined) => (v ?? "").split(",").map((t) => t.trim()).filter(Boolean);

// The New channel / Edit form's song picker: how many published songs some
// albums and tags add up to (neither = the whole catalogue, as Kizzi Radio).
channelRoutes.get("/pool", async (c) => {
  const tracks = await autopilotTracks(c.env.DB, listParam(c.req.query("tags")), listParam(c.req.query("albums")));
  return c.json({ tracks: tracks.length, seconds: tracks.reduce((s, t) => s + t.duration_seconds, 0) });
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

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type ChannelForm = {
  name?: string;
  slug?: string;
  emoji?: string | null;
  description?: string | null;
  accent?: string | null;
  card_image?: string | null;
  card_video?: string | null;
  short_label?: string | null;
  tags?: string[];
  albums?: string[];
};

const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};
// A card file: an R2 key from the Studio upload, or one of the app's own files (/channels/...).
const mediaKey = (v: unknown) => {
  const s = text(v, 300);
  return s && !s.includes("..") ? s : null;
};

/** The New channel / Edit form's fields, checked. Only the fields sent are returned. */
async function readForm(db: D1Database, body: ChannelForm, current: Channel | null): Promise<{ error: string } | { fields: Record<string, unknown> }> {
  const fields: Record<string, unknown> = {};
  if (body.name !== undefined || !current) {
    const name = text(body.name, 60);
    if (!name) return { error: "Give the channel a name." };
    fields.name = name;
  }
  if (body.slug !== undefined && body.slug !== current?.slug) {
    // A live channel's address is in listeners' links and bookmarks: it stays put.
    if (current && current.status === "live") return { error: "A live channel's web address can't change." };
    const slug = String(body.slug ?? "").trim();
    if (!SLUG_RE.test(slug) || slug.length > 40) return { error: "The web address can only use lower-case letters, numbers and single dashes." };
    const taken = await db.prepare("SELECT 1 FROM channels WHERE slug = ?").bind(slug).first();
    if (taken) return { error: `Another channel already uses "${slug}".` };
    fields.slug = slug;
  } else if (!current) {
    return { error: "Give the channel a web address." };
  }
  if (body.emoji !== undefined) fields.emoji = text(body.emoji, 8);
  if (body.description !== undefined) fields.description = text(body.description, 160);
  if (body.short_label !== undefined) fields.short_label = text(body.short_label, 24);
  if (body.accent !== undefined) {
    if (body.accent && !HEX_RE.test(body.accent)) return { error: "The accent colour should look like #8B5CF6." };
    fields.accent = body.accent ? body.accent.toUpperCase() : null;
  }
  if (body.card_image !== undefined) fields.card_image = mediaKey(body.card_image);
  if (body.card_video !== undefined) fields.card_video = mediaKey(body.card_video);
  if (body.tags !== undefined || body.albums !== undefined) {
    const tags = [...new Set((body.tags ?? (current ? channelTags(current) : [])).map((t) => String(t).trim()).filter(Boolean))];
    const albums = [...new Set((body.albums ?? (current ? channelAlbums(current) : [])).map((a) => String(a).trim()).filter(Boolean))];
    const same =
      current &&
      tags.slice().sort().join(",") === channelTags(current).slice().sort().join(",") &&
      albums.slice().sort().join(",") === channelAlbums(current).slice().sort().join(",");
    // Unchanged songs keep the stored rules exactly, so the Scheduler doesn't rebuild for nothing.
    if (!same) fields.catalogue_rules = tags.length || albums.length ? JSON.stringify({ ...(tags.length ? { tags_any: tags } : {}), ...(albums.length ? { albums_any: albums } : {}) }) : null;
  }
  return { fields };
}

// New channel (Studio Channels page). Always starts in building, on autopilot:
// nothing about it is public until Go live.
channelRoutes.post("/", async (c) => {
  const body = await c.req.json<ChannelForm>().catch(() => ({}) as ChannelForm);
  const form = await readForm(c.env.DB, body, null);
  if ("error" in form) return c.json({ error: form.error }, 400);
  const f = form.fields;

  const id = newId("ch");
  await c.env.DB.prepare(
    `INSERT INTO channels (id, slug, name, emoji, description, status, catalogue_rules, programming_mode,
                           accent, card_image, card_video, short_label, created_at)
     VALUES (?,?,?,?,?,'building',?,'autopilot',?,?,?,?,?)`
  )
    .bind(
      id,
      f.slug,
      f.name,
      f.emoji ?? null,
      f.description ?? null,
      f.catalogue_rules ?? null,
      f.accent ?? null,
      f.card_image ?? null,
      f.card_video ?? null,
      f.short_label ?? null,
      nowIso()
    )
    .run();

  return c.json({ id }, 201);
});

// Edit (and the "Switch to autopilot/manual" button): only these fields.
channelRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const current = await c.env.DB.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<Channel>();
  if (!current) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<ChannelForm & { programming_mode?: string }>().catch(() => ({}) as ChannelForm & { programming_mode?: string });
  const form = await readForm(c.env.DB, body, current);
  if ("error" in form) return c.json({ error: form.error }, 400);
  const fields = form.fields;
  if (body.programming_mode !== undefined) {
    if (body.programming_mode !== "manual" && body.programming_mode !== "autopilot") return c.json({ error: "programming_mode must be manual or autopilot" }, 400);
    fields.programming_mode = body.programming_mode;
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) return c.json({ ok: true });

  await c.env.DB.prepare(`UPDATE channels SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .bind(...keys.map((k) => fields[k]), id)
    .run();

  return c.json({ ok: true });
});

// One explicit action to flip building <-> live (Section 10). Going live also
// puts the channel on the Scheduler when its shadow checks allow it.
channelRoutes.post("/:id/status", async (c) => {
  const id = c.req.param("id");
  const { status } = await c.req.json<{ status: "building" | "live" }>();
  if (status !== "building" && status !== "live") {
    return c.json({ error: "status must be 'building' or 'live'" }, 400);
  }
  await c.env.DB.prepare("UPDATE channels SET status = ? WHERE id = ?").bind(status, id).run();
  if (status === "live") {
    const ch = await c.env.DB.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<Channel>();
    if (ch) return c.json({ ok: true, scheduler: await enableOnGoLive(c.env, ch) });
  }
  return c.json({ ok: true });
});

// Lightweight advisory checklist before going live - a nudge, not a hard gate.
channelRoutes.get("/:id/launch-checklist", async (c) => {
  const id = c.req.param("id");
  const channel = await c.env.DB.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<Channel>();
  if (!channel) return c.json({ error: "not found" }, 404);

  let taggedTrackCount = 0;
  try {
    const tags = channelTags(channel);
    const albums = channelAlbums(channel);
    if (tags.length || albums.length) taggedTrackCount = (await autopilotTracks(c.env.DB, tags, albums)).length;
  } catch {
    // malformed catalogue_rules - checklist just reports 0, doesn't block anything
  }

  const spokenContentCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM audio_assets WHERE status = 'published'"
  ).first<{ n: number }>();

  return c.json({
    checklist: {
      has_artwork: Boolean(channel.artwork_url || channel.card_image),
      has_matching_tracks: taggedTrackCount > 0,
      matching_track_count: taggedTrackCount,
      has_published_spoken_content: (spokenContentCount?.n ?? 0) > 0,
    },
  });
});
