import { Hono } from "hono";
import type { Env } from "../lib/types";
import { createPresignedUploadUrl } from "../lib/r2presign";
import { newId, nowIso } from "../lib/id";

/**
 * Studio Bulk Import: many tracks in one sitting, as editable drafts.
 *
 * The flow (see app/src/studio/pages/BulkImport.tsx):
 *   1. the grid saves what Kizzi types as she goes   -> POST /rows/save
 *   2. picking the same folder again restores it     -> POST /rows/lookup
 *   3. files get presigned upload URLs in batches    -> POST /presign
 *   4. each uploaded file becomes a DRAFT track      -> POST /complete
 * plus duplicate detection by content hash (/duplicates, /backfill-hashes).
 *
 * Nothing here publishes: tracks stay drafts, fully editable, until Kizzi
 * promotes them from the Drafts page.
 */
export const bulkImportRoutes = new Hono<{ Bindings: Env }>();

const CHUNK = 90; // D1 allows at most 100 bound parameters per query

interface RowInput {
  file_key: string;
  filename: string;
  size_bytes?: number | null;
  title?: string;
  artist?: string | null;
  album_id?: string | null;
  track_number?: number | null;
  tags?: string[];
  content_hash?: string | null;
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean))).slice(0, 30);
}

function cleanInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Replace a track's tags (mirrors PUT /studio/api/tracks/:id/tags, but in one batch).
function tagStatements(db: D1Database, trackId: string, tags: string[]): D1PreparedStatement[] {
  const statements = [db.prepare("DELETE FROM track_tags WHERE track_id = ?").bind(trackId)];
  for (const name of tags) {
    statements.push(
      db.prepare("INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING").bind(newId("tag"), name),
      db
        .prepare(
          "INSERT INTO track_tags (track_id, tag_id) SELECT ?, id FROM tags WHERE name = ? ON CONFLICT DO NOTHING"
        )
        .bind(trackId, name)
    );
  }
  return statements;
}

function upsertRow(db: D1Database, row: RowInput, trackId: string | null = null): D1PreparedStatement {
  const ts = nowIso();
  return db
    .prepare(
      `INSERT INTO import_rows
         (id, file_key, filename, size_bytes, title, artist, album_id, track_number, tags, content_hash, track_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(file_key) DO UPDATE SET
         filename = excluded.filename,
         size_bytes = excluded.size_bytes,
         title = excluded.title,
         artist = excluded.artist,
         album_id = excluded.album_id,
         track_number = excluded.track_number,
         tags = excluded.tags,
         content_hash = COALESCE(excluded.content_hash, import_rows.content_hash),
         track_id = COALESCE(excluded.track_id, import_rows.track_id),
         updated_at = excluded.updated_at`
    )
    .bind(
      newId("imp"),
      row.file_key,
      row.filename,
      row.size_bytes ?? null,
      (row.title ?? "").trim(),
      row.artist?.trim() || null,
      row.album_id || null,
      cleanInt(row.track_number),
      JSON.stringify(cleanTags(row.tags)),
      row.content_hash || null,
      trackId,
      ts,
      ts
    );
}

// ------------------------------------------------------------ save as you go

// What has already been typed for these files? (Used when a folder is picked again.)
bulkImportRoutes.post("/rows/lookup", async (c) => {
  const { file_keys } = await c.req.json<{ file_keys?: string[] }>();
  if (!Array.isArray(file_keys) || file_keys.length === 0) return c.json({ rows: [] });

  const rows: unknown[] = [];
  for (let i = 0; i < file_keys.length; i += CHUNK) {
    const chunk = file_keys.slice(i, i + CHUNK);
    const { results } = await c.env.DB.prepare(
      `SELECT r.file_key, r.title, r.artist, r.album_id, r.track_number, r.tags, r.content_hash, r.track_id,
              t.status AS track_status
       FROM import_rows r LEFT JOIN tracks t ON t.id = r.track_id
       WHERE r.file_key IN (${chunk.map(() => "?").join(",")})`
    )
      .bind(...chunk)
      .all();
    rows.push(...results);
  }
  return c.json({ rows });
});

// Save (or update) rows. A row whose file has already been uploaded also
// updates its draft track, so a draft stays editable from inside the import
// flow exactly as it is from the Drafts page.
bulkImportRoutes.post("/rows/save", async (c) => {
  const { rows } = await c.req.json<{ rows?: RowInput[] }>();
  if (!Array.isArray(rows) || rows.length === 0) return c.json({ saved: 0 });
  if (rows.length > 60) return c.json({ error: "save at most 60 rows at a time" }, 400);

  const valid = rows.filter((r) => r.file_key && r.filename);
  await c.env.DB.batch(valid.map((r) => upsertRow(c.env.DB, r)));

  // Write-through for rows that already have a track.
  const keys = valid.map((r) => r.file_key);
  const { results: linked } = await c.env.DB.prepare(
    `SELECT file_key, track_id FROM import_rows
     WHERE track_id IS NOT NULL AND file_key IN (${keys.map(() => "?").join(",")})`
  )
    .bind(...keys)
    .all<{ file_key: string; track_id: string }>();

  const byKey = new Map(valid.map((r) => [r.file_key, r]));
  const statements: D1PreparedStatement[] = [];
  const ts = nowIso();
  for (const { file_key, track_id } of linked) {
    const row = byKey.get(file_key)!;
    const title = (row.title ?? "").trim();
    if (!title) continue; // a track can't lose its title
    statements.push(
      c.env.DB.prepare(
        "UPDATE tracks SET title = ?, artist = ?, album_id = ?, track_number = ?, updated_at = ? WHERE id = ?"
      ).bind(title, row.artist?.trim() || null, row.album_id || null, cleanInt(row.track_number), ts, track_id),
      ...tagStatements(c.env.DB, track_id, cleanTags(row.tags))
    );
  }
  if (statements.length > 0) await c.env.DB.batch(statements);

  return c.json({ saved: valid.length });
});

bulkImportRoutes.get("/summary", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM import_rows WHERE track_id IS NULL AND TRIM(title) <> '') AS typed_not_uploaded,
       (SELECT COUNT(*) FROM import_rows WHERE track_id IS NOT NULL) AS uploaded,
       (SELECT COUNT(*) FROM tracks WHERE status = 'draft') AS drafts,
       (SELECT COUNT(*) FROM tracks WHERE content_hash IS NULL) AS unfingerprinted`
  ).first();
  return c.json(row ?? {});
});

// ------------------------------------------------------------------- upload

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wma: "audio/x-ms-wma",
};

// Presigned upload URLs for a whole batch in one request (the single-track
// wizard asks for one at a time; a folder of hundreds shouldn't).
bulkImportRoutes.post("/presign", async (c) => {
  const { files } = await c.req.json<{ files?: { filename: string; content_type?: string }[] }>();
  if (!Array.isArray(files) || files.length === 0) return c.json({ error: "files are required" }, 400);
  if (files.length > 50) return c.json({ error: "at most 50 files per request" }, 400);

  const uploads = await Promise.all(
    files.map(async (file) => {
      const safeName = (file.filename || "track").replace(/[^a-zA-Z0-9_.-]/g, "_");
      const ext = safeName.split(".").pop()?.toLowerCase() ?? "";
      const contentType = file.content_type || MIME_BY_EXT[ext] || "audio/mpeg";
      const key = `audio/${newId("upl")}-${safeName}`;
      return { key, content_type: contentType, upload_url: await createPresignedUploadUrl(c.env, key, contentType) };
    })
  );
  return c.json({ uploads });
});

// Called once a file is safely in R2: create its DRAFT track from what was
// typed in the grid. Idempotent - a retry after a dropped connection returns
// the track that was already made rather than a second copy.
bulkImportRoutes.post("/complete", async (c) => {
  const body = await c.req.json<
    RowInput & { audio_key?: string; duration_seconds?: number; allow_duplicate?: boolean }
  >();
  const title = (body.title ?? "").trim();
  if (!body.file_key || !body.filename || !body.audio_key) {
    return c.json({ error: "file_key, filename and audio_key are required" }, 400);
  }
  if (!title) return c.json({ error: "give the track a title first" }, 400);
  const duration = Math.round(Number(body.duration_seconds));
  if (!Number.isFinite(duration) || duration <= 0) return c.json({ error: "duration_seconds is required" }, 400);

  const existing = await c.env.DB.prepare("SELECT track_id FROM import_rows WHERE file_key = ?")
    .bind(body.file_key)
    .first<{ track_id: string | null }>();
  if (existing?.track_id) return c.json({ track_id: existing.track_id, already_imported: true });

  if (body.content_hash && !body.allow_duplicate) {
    const dupe = await c.env.DB.prepare("SELECT id, title FROM tracks WHERE content_hash = ? LIMIT 1")
      .bind(body.content_hash)
      .first<{ id: string; title: string }>();
    if (dupe) return c.json({ error: "duplicate", duplicate_of: dupe }, 409);
  }

  const trackId = newId("trk");
  const ts = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tracks (id, title, artist, album_id, track_number, duration_seconds, audio_url, content_hash,
                           explicit, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,0,'draft',?,?)`
    ).bind(
      trackId,
      title,
      body.artist?.trim() || null,
      body.album_id || null,
      cleanInt(body.track_number),
      duration,
      body.audio_key,
      body.content_hash || null,
      ts,
      ts
    ),
    ...tagStatements(c.env.DB, trackId, cleanTags(body.tags)),
    upsertRow(c.env.DB, body, trackId),
  ]);

  return c.json({ track_id: trackId }, 201);
});

// ------------------------------------------------------------- duplicates

// Which of these file fingerprints already belong to a track?
bulkImportRoutes.post("/duplicates", async (c) => {
  const { hashes } = await c.req.json<{ hashes?: string[] }>();
  if (!Array.isArray(hashes) || hashes.length === 0) return c.json({ matches: [] });

  const matches: unknown[] = [];
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    const { results } = await c.env.DB.prepare(
      `SELECT content_hash AS hash, id AS track_id, title, status FROM tracks
       WHERE content_hash IN (${chunk.map(() => "?").join(",")})`
    )
      .bind(...chunk)
      .all();
    matches.push(...results);
  }
  return c.json({ matches });
});

// Tracks uploaded before fingerprints existed have none, so a few at a time
// are read back out of R2 and hashed (streamed - nothing is held in memory).
// The import page calls this in the background until nothing is left.
bulkImportRoutes.post("/backfill-hashes", async (c) => {
  const { limit } = await c.req.json<{ limit?: number }>().catch(() => ({}) as { limit?: number });
  const take = Math.min(Math.max(Number(limit) || 3, 1), 5);

  const { results } = await c.env.DB.prepare(
    "SELECT id, audio_url FROM tracks WHERE content_hash IS NULL LIMIT ?"
  )
    .bind(take)
    .all<{ id: string; audio_url: string }>();

  let hashed = 0;
  for (const track of results) {
    let hash = "unavailable"; // marks a file that can't be read, so it isn't retried forever
    const object = await c.env.MEDIA.get(track.audio_url);
    if (object) {
      const digest = new crypto.DigestStream("SHA-256");
      await object.body.pipeTo(digest);
      hash = Array.from(new Uint8Array(await digest.digest), (b) => b.toString(16).padStart(2, "0")).join("");
      hashed++;
    }
    await c.env.DB.prepare("UPDATE tracks SET content_hash = ? WHERE id = ?").bind(hash, track.id).run();
  }

  const remaining = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tracks WHERE content_hash IS NULL").first<{ n: number }>();
  return c.json({ hashed, remaining: remaining?.n ?? 0 });
});
