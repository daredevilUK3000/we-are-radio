import { Hono } from "hono";
import type { Channel, Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { autopilotTracks, channelAlbums, channelTags, currentProgramme } from "../lib/station";

/**
 * Song intros (handoff_import_intros.md, migrations/0030), for the Studio's
 * Tracks page: each song's intro and how it plays, importing a batch made by
 * the Intro Maker app, and which songs each channel plays (for the page's
 * channel filter and the songs export). Mounted behind requireStudioAuth.
 *
 * An intro is a 'link' audio asset with link_kind NULL tied to one song in
 * track_intros; everywhere a song plays picks it up with the song's pins
 * (station.ts loadPinnedJingles), and every link picker skips it.
 */
export const introRoutes = new Hono<{ Bindings: Env }>();

// Music level under an intro played over a song's opening: as for new jingles (routes/audioAssets.ts).
const INTRO_DUCK_LEVEL = 0.11;
const MAX_INTRO_SECONDS = 120;
export const IMPORT_BATCH = 16;

interface IntroRow {
  track_id: string;
  audio_asset_id: string;
  play_mode: "before" | "over";
  start_offset_seconds: number;
  enabled: number;
  title: string;
  audio_url: string;
  duration_seconds: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** The songs each channel plays: an autopilot channel's pool (its tags and albums), or a manual channel's current programme. */
async function channelSongs(db: D1Database): Promise<{ id: string; slug: string; name: string; status: string; track_ids: string[] }[]> {
  const { results: channels } = await db.prepare("SELECT * FROM channels ORDER BY created_at ASC").all<Channel>();
  return Promise.all(
    channels.map(async (ch) => {
      let ids: string[] = [];
      if (ch.programming_mode === "autopilot") {
        ids = (await autopilotTracks(db, channelTags(ch), channelAlbums(ch))).map((t) => t.id);
      } else {
        const programme = await currentProgramme(db, ch.id);
        if (programme) {
          const { results } = await db
            .prepare("SELECT DISTINCT track_id FROM programme_items WHERE programme_id = ? AND track_id IS NOT NULL")
            .bind(programme.id)
            .all<{ track_id: string }>();
          ids = results.map((r) => r.track_id);
        }
      }
      return { id: ch.id, slug: ch.slug, name: ch.name, status: ch.status, track_ids: ids };
    })
  );
}

introRoutes.get("/", async (c) => {
  const { results: intros } = await c.env.DB.prepare(
    `SELECT ti.*, aa.title, aa.audio_url, aa.duration_seconds, aa.description
     FROM track_intros ti JOIN audio_assets aa ON aa.id = ti.audio_asset_id`
  ).all<IntroRow>();
  return c.json({ intros, channels: await channelSongs(c.env.DB) });
});

interface ImportItem {
  track_id: string;
  /** The R2 key the browser uploaded the MP3 to (routes/upload.ts presign, folder "audio"). */
  audio_url: string;
  duration_seconds: number;
  script?: string | null;
  /** The song already has an intro: true replaces it, false leaves it as it is. */
  replace?: boolean;
}

/**
 * Attaches uploaded intros to their songs: each becomes a link titled
 * "Intro: <song title>" with its script in the description, played before
 * the song. A song that already has an intro keeps it unless `replace` is
 * set; a replacement keeps the song's play settings.
 */
introRoutes.post("/import", async (c) => {
  const body = await c.req.json<{ items?: ImportItem[] }>().catch(() => ({}) as { items?: ImportItem[] });
  const items = Array.isArray(body.items) ? body.items : [];
  // At most 3 statements per intro, all in one batch (all or nothing): 16 keeps it within 50, as store.ts does.
  if (items.length === 0 || items.length > IMPORT_BATCH) return c.json({ error: `Send between 1 and ${IMPORT_BATCH} intros at a time.` }, 400);

  const seen = new Set<string>();
  for (const it of items) {
    const seconds = Number(it.duration_seconds);
    if (!it.track_id || typeof it.audio_url !== "string" || !it.audio_url.startsWith("audio/")) {
      return c.json({ error: "Each intro needs a song and an uploaded file." }, 400);
    }
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_INTRO_SECONDS) {
      return c.json({ error: `An intro must be between 1 and ${MAX_INTRO_SECONDS} seconds long.` }, 400);
    }
    if (seen.has(it.track_id)) return c.json({ error: "Two intros were matched to the same song. Pick one of them." }, 400);
    seen.add(it.track_id);
  }

  const ids = items.map((i) => i.track_id);
  const marks = ids.map(() => "?").join(",");
  const { results: tracks } = await c.env.DB.prepare(`SELECT id, title FROM tracks WHERE id IN (${marks})`)
    .bind(...ids)
    .all<{ id: string; title: string }>();
  const titleOf = new Map(tracks.map((t) => [t.id, t.title]));
  const { results: existing } = await c.env.DB.prepare(
    `SELECT ti.track_id, ti.audio_asset_id, aa.audio_url FROM track_intros ti JOIN audio_assets aa ON aa.id = ti.audio_asset_id
     WHERE ti.track_id IN (${marks})`
  )
    .bind(...ids)
    .all<{ track_id: string; audio_asset_id: string; audio_url: string }>();
  const oldAsset = new Map(existing.map((e) => [e.track_id, e.audio_asset_id]));
  const oldFile = new Map(existing.map((e) => [e.track_id, e.audio_url]));
  const filesToDelete: string[] = [];

  const ts = nowIso();
  const statements: D1PreparedStatement[] = [];
  let imported = 0;
  let replaced = 0;
  let kept = 0;
  const missing: string[] = [];
  for (const it of items) {
    const title = titleOf.get(it.track_id);
    if (!title) {
      missing.push(it.track_id);
      continue;
    }
    const previous = oldAsset.get(it.track_id);
    if (previous && !it.replace) {
      kept++;
      continue;
    }
    const assetId = newId("aa");
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO audio_assets (id, type, title, audio_url, duration_seconds, description, status, link_kind, duck_level, created_at)
         VALUES (?, 'link', ?, ?, ?, ?, 'published', NULL, ?, ?)`
      ).bind(assetId, `Intro: ${title}`, it.audio_url, Math.max(1, Math.round(Number(it.duration_seconds))), it.script?.trim() || null, INTRO_DUCK_LEVEL, ts)
    );
    if (previous) {
      // The new recording, the song's existing settings; then the old recording goes.
      statements.push(c.env.DB.prepare("UPDATE track_intros SET audio_asset_id = ?, updated_at = ? WHERE track_id = ?").bind(assetId, ts, it.track_id));
      statements.push(c.env.DB.prepare("DELETE FROM audio_assets WHERE id = ?").bind(previous));
      const file = oldFile.get(it.track_id);
      if (file?.startsWith("audio/") && file !== it.audio_url) filesToDelete.push(file);
      replaced++;
    } else {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO track_intros (track_id, audio_asset_id, play_mode, start_offset_seconds, enabled, created_at, updated_at)
           VALUES (?, ?, 'before', 2, 1, ?, ?)`
        ).bind(it.track_id, assetId, ts, ts)
      );
      imported++;
    }
  }
  if (statements.length) await c.env.DB.batch(statements);
  if (filesToDelete.length) await c.env.MEDIA.delete(filesToDelete).catch(() => {});
  return c.json({ imported, replaced, kept, missing });
});

/** How one song's intro plays: before the song or over its opening (and how far in), or switched off. */
introRoutes.patch("/:trackId", async (c) => {
  const trackId = c.req.param("trackId");
  const body = await c.req.json<{ play_mode?: string; start_offset_seconds?: number; enabled?: boolean }>().catch(() => ({}) as Record<string, never>);
  const row = await c.env.DB.prepare("SELECT track_id FROM track_intros WHERE track_id = ?").bind(trackId).first();
  if (!row) return c.json({ error: "This song has no intro." }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.play_mode !== undefined) {
    if (body.play_mode !== "before" && body.play_mode !== "over") return c.json({ error: "play_mode must be 'before' or 'over'" }, 400);
    sets.push("play_mode = ?");
    values.push(body.play_mode);
  }
  if (body.start_offset_seconds !== undefined) {
    const v = Math.round(Number(body.start_offset_seconds));
    if (!Number.isFinite(v) || v < 0 || v > 120) return c.json({ error: "The start must be between 0 and 120 seconds into the song." }, 400);
    sets.push("start_offset_seconds = ?");
    values.push(v);
  }
  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(body.enabled ? 1 : 0);
  }
  if (sets.length === 0) return c.json({ error: "Nothing to change." }, 400);
  await c.env.DB.prepare(`UPDATE track_intros SET ${sets.join(", ")}, updated_at = ? WHERE track_id = ?`)
    .bind(...values, nowIso(), trackId)
    .run();
  return c.json({ ok: true });
});

/** Removes a song's intro: the link and its file go too (an intro belongs to one song only). */
introRoutes.delete("/:trackId", async (c) => {
  const trackId = c.req.param("trackId");
  const row = await c.env.DB.prepare(
    "SELECT ti.audio_asset_id, aa.audio_url FROM track_intros ti JOIN audio_assets aa ON aa.id = ti.audio_asset_id WHERE ti.track_id = ?"
  )
    .bind(trackId)
    .first<{ audio_asset_id: string; audio_url: string }>();
  if (!row) return c.json({ error: "This song has no intro." }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM track_intros WHERE track_id = ?").bind(trackId),
    c.env.DB.prepare("DELETE FROM audio_assets WHERE id = ?").bind(row.audio_asset_id),
  ]);
  if (row.audio_url.startsWith("audio/")) await c.env.MEDIA.delete(row.audio_url).catch(() => {});
  return c.json({ ok: true });
});
