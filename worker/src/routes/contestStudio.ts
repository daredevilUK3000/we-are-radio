import { Hono, type Context } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { requireSameOrigin } from "../lib/origin";
import { CONTEST } from "../lib/contest";
import { sendEmail, templates } from "../lib/email";
import { isCountryCode } from "../lib/countries";
import { streamR2Object } from "../lib/stream";

/**
 * Top 3 contest - the Studio review side (mounted at /studio/api/contest,
 * behind requireStudioAuth). Unlike the public routes this sees everything,
 * including entrants' private details, and every change it makes is written
 * to contest_audit so decisions can be looked back on.
 *
 * Files move between R2 prefixes as an entry's status changes (see
 * routes/media.ts for why): pending -> approved on approval, approved ->
 * removed on disqualify/withdraw. Rejected songs stay under pending.
 */
export const contestStudioRoutes = new Hono<{ Bindings: Env }>();
contestStudioRoutes.use("*", requireSameOrigin);

type Ctx = Context<{ Bindings: Env }>;

const STATUSES = ["unconfirmed", "pending", "approved", "rejected", "disqualified", "withdrawn"] as const;

interface EntryRow {
  id: number;
  entrant_id: string;
  title: string;
  creator_name: string;
  country_code: string;
  created_or_released: string;
  ai_tools: string | null;
  collecting_society: string | null;
  bio: string | null;
  links_json: string | null;
  photo_key: string | null;
  audio_key: string;
  audio_bytes: number;
  duration_seconds: number | null;
  status: (typeof STATUSES)[number];
  status_reason: string | null;
  confirmed_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  library_track_id: string | null;
  created_at: string;
  updated_at: string;
  legal_name: string;
  email: string;
}

const ENTRY_SELECT = `SELECT e.id, e.entrant_id, e.title, e.creator_name, e.country_code, e.created_or_released, e.ai_tools,
    e.collecting_society, e.bio, e.links_json, e.photo_key, e.audio_key, e.audio_bytes, e.duration_seconds, e.status,
    e.status_reason, e.confirmed_at, e.reviewed_at, e.approved_at, e.library_track_id, e.created_at, e.updated_at,
    p.legal_name, p.email
  FROM contest_entries e JOIN contest_entrants p ON p.id = e.entrant_id`;

const parseLinks = (json: string | null): string[] => {
  try {
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
};
const shape = (r: EntryRow) => {
  const { links_json, ...rest } = r;
  return { ...rest, links: parseLinks(links_json) };
};

async function loadEntry(env: Env, id: string): Promise<EntryRow | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return env.DB.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).bind(n).first<EntryRow>();
}

const audit = (env: Env, action: string, target: string, detail: unknown) =>
  env.DB.prepare("INSERT INTO contest_audit (actor, action, target, detail_json, created_at) VALUES ('studio', ?, ?, ?, ?)").bind(
    action,
    target,
    JSON.stringify(detail),
    nowIso()
  );

// The public counter and country list are cached for a minute; drop that
// cache whenever an approval changes them, so the Studio sees its own change.
const clearStateCache = (env: Env) => env.CONFIG.delete("contest:state");

/** R2 has no rename: copy with the same metadata, and the caller deletes the original once the database agrees. */
async function copyObject(env: Env, from: string, to: string): Promise<boolean> {
  const obj = await env.MEDIA.get(from);
  if (!obj) return false;
  await env.MEDIA.put(to, obj.body, { httpMetadata: obj.httpMetadata });
  return true;
}

/**
 * Moves an entry's audio and photo to another prefix and records the new keys
 * - copy, update the row (only if it's still in the expected status), then
 * delete the old copies. If the row changed under us, the new copies are
 * removed instead and false is returned.
 */
async function moveEntryFiles(
  env: Env,
  entry: EntryRow,
  to: "approved" | "removed",
  update: (audioKey: string, photoKey: string | null) => D1PreparedStatement
): Promise<boolean> {
  const rekey = (key: string) => key.replace(/^contest\/(pending|approved|removed)\//, `contest/${to}/`);
  const audioKey = rekey(entry.audio_key);
  const photoKey = entry.photo_key ? rekey(entry.photo_key) : null;
  const moving = audioKey !== entry.audio_key;

  if (moving) {
    if (!(await copyObject(env, entry.audio_key, audioKey))) throw new Error(`audio file missing: ${entry.audio_key}`);
    // A missing photo just drops the photo rather than blocking the decision.
    if (photoKey && entry.photo_key && !(await copyObject(env, entry.photo_key, photoKey))) {
      return moveEntryFiles(env, { ...entry, photo_key: null }, to, update);
    }
  }
  const result = await update(audioKey, photoKey).run();
  if (result.meta.changes === 0) {
    if (moving) await env.MEDIA.delete([audioKey, ...(photoKey ? [photoKey] : [])]);
    return false;
  }
  if (moving) await env.MEDIA.delete([entry.audio_key, ...(entry.photo_key ? [entry.photo_key] : [])]);
  return true;
}

// ----------------------------------------------------------------- reading

contestStudioRoutes.get("/entries", async (c) => {
  const status = c.req.query("status") ?? "pending";
  const q = (c.req.query("q") ?? "").trim();
  let sql = `${ENTRY_SELECT} WHERE 1=1`;
  const params: unknown[] = [];
  if (status !== "all") {
    if (!(STATUSES as readonly string[]).includes(status)) return c.json({ error: "unknown status" }, 400);
    sql += " AND e.status = ?";
    params.push(status);
  }
  if (q) {
    sql += " AND (e.title LIKE ? OR e.creator_name LIKE ? OR p.email LIKE ? OR CAST(e.id AS TEXT) = ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q.replace(/^#/, ""));
  }
  // Pending is a queue, so it's worked oldest first; every other list is newest first.
  sql += status === "pending" ? " ORDER BY e.confirmed_at ASC, e.id ASC" : " ORDER BY e.id DESC";
  sql += " LIMIT 1000";

  const [{ results }, { results: counts }] = await Promise.all([
    c.env.DB.prepare(sql)
      .bind(...params)
      .all<EntryRow>(),
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM contest_entries GROUP BY status").all<{ status: string; n: number }>(),
  ]);
  return c.json({
    entries: results.map(shape),
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
  });
});

contestStudioRoutes.get("/entries/:id", async (c) => {
  const entry = await loadEntry(c.env, c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  const [{ results: others }, { results: history }] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, title, status, created_at FROM contest_entries WHERE entrant_id = ? AND id != ? ORDER BY id"
    )
      .bind(entry.entrant_id, entry.id)
      .all(),
    c.env.DB.prepare("SELECT action, detail_json, created_at FROM contest_audit WHERE target = ? ORDER BY id DESC LIMIT 50")
      .bind(`entry:${entry.id}`)
      .all(),
  ]);
  return c.json({ entry: shape(entry), others, history });
});

// The Studio can hear and see an entry whatever its status (the public
// /media route refuses anything not approved).
const streamEntryFile = (kind: "audio" | "photo") => async (c: Ctx) => {
  const entry = await loadEntry(c.env, c.req.param("id") ?? "");
  const key = kind === "audio" ? entry?.audio_key : entry?.photo_key;
  if (!key) return c.notFound();
  const res = await streamR2Object(c.env.MEDIA, key, c.req.header("Range"), "private, no-store");
  return res ?? c.notFound();
};
contestStudioRoutes.get("/entries/:id/audio", streamEntryFile("audio"));
contestStudioRoutes.get("/entries/:id/photo", streamEntryFile("photo"));

// ----------------------------------------------------------------- editing

// Display fields only - a typo in a title, a wrong country. What the entrant
// declared (dates, AI tools, society, legal name, email) is theirs and isn't
// editable here.
contestStudioRoutes.patch("/entries/:id", async (c) => {
  const entry = await loadEntry(c.env, c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);

  const changes: Record<string, string | null> = {};
  if (body.title !== undefined) {
    const v = String(body.title).trim();
    if (!v || v.length > 120) return c.json({ error: "Title must be 1-120 characters." }, 400);
    changes.title = v;
  }
  if (body.creator_name !== undefined) {
    const v = String(body.creator_name).trim();
    if (!v || v.length > 80) return c.json({ error: "Creator name must be 1-80 characters." }, 400);
    changes.creator_name = v;
  }
  if (body.country_code !== undefined) {
    const v = String(body.country_code).trim().toUpperCase();
    if (!isCountryCode(v)) return c.json({ error: "Unknown country." }, 400);
    changes.country_code = v;
  }
  if (body.bio !== undefined) {
    const v = String(body.bio ?? "").trim();
    if (v.length > 300) return c.json({ error: "Bio must be 300 characters or fewer." }, 400);
    changes.bio = v || null;
  }
  if (body.links !== undefined) {
    const links = (Array.isArray(body.links) ? body.links : []).map((l) => String(l).trim()).filter(Boolean);
    if (links.length > 3) return c.json({ error: "Up to 3 links." }, 400);
    for (const l of links) {
      let ok = false;
      try {
        ok = l.length <= 300 && new URL(l).protocol === "https:";
      } catch {
        ok = false;
      }
      if (!ok) return c.json({ error: `Not an https link: ${l}` }, 400);
    }
    changes.links_json = links.length ? JSON.stringify(links) : null;
  }
  const fields = Object.keys(changes);
  if (fields.length === 0) return c.json({ ok: true });

  const before = Object.fromEntries(fields.map((f) => [f, (entry as unknown as Record<string, unknown>)[f] ?? null]));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE contest_entries SET ${fields.map((f) => `${f} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(
      ...fields.map((f) => changes[f]),
      nowIso(),
      entry.id
    ),
    audit(c.env, "edit", `entry:${entry.id}`, { before, after: changes }),
  ]);
  // A library copy keeps its title/artist in step with the entry.
  if (entry.library_track_id && (changes.title || changes.creator_name)) {
    await c.env.DB.prepare("UPDATE tracks SET title = ?, artist = ?, updated_at = ? WHERE id = ?")
      .bind(changes.title ?? entry.title, changes.creator_name ?? entry.creator_name, nowIso(), entry.library_track_id)
      .run();
  }
  if (entry.status === "approved" && changes.country_code) await clearStateCache(c.env);
  return c.json({ ok: true });
});

// ------------------------------------------------------------- decisions

const activeCountFor = async (env: Env, entrantId: string) =>
  (
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM contest_entries WHERE entrant_id = ? AND status NOT IN ('withdrawn','rejected')"
    )
      .bind(entrantId)
      .first<{ n: number }>()
  )?.n ?? 0;

contestStudioRoutes.post("/entries/:id/review", async (c) => {
  const entry = await loadEntry(c.env, c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  if (entry.status !== "pending") return c.json({ error: `This entry is ${entry.status}, not pending.` }, 409);
  const { decision, reason } = await c.req.json<{ decision?: string; reason?: string }>().catch(() => ({}) as Record<string, never>);
  const ts = nowIso();

  if (decision === "approve") {
    const moved = await moveEntryFiles(c.env, entry, "approved", (audioKey, photoKey) =>
      c.env.DB.prepare(
        `UPDATE contest_entries SET status = 'approved', audio_key = ?, photo_key = ?, status_reason = NULL,
           reviewed_at = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`
      ).bind(audioKey, photoKey, ts, ts, ts, entry.id)
    );
    if (!moved) return c.json({ error: "This entry changed while you were looking at it. Reload and try again." }, 409);
    await audit(c.env, "approve", `entry:${entry.id}`, {}).run();
    await clearStateCache(c.env);
    c.executionCtx.waitUntil(sendEmail(c.env, templates.entryApproved(entry.email, { id: entry.id, title: entry.title })));
    return c.json({ ok: true });
  }

  if (decision === "reject") {
    const why = String(reason ?? "").trim();
    if (!why) return c.json({ error: "Please give a reason - it's included in the email to the entrant." }, 400);
    if (why.length > 1000) return c.json({ error: "Please keep the reason under 1,000 characters." }, 400);
    const result = await c.env.DB.prepare(
      `UPDATE contest_entries SET status = 'rejected', status_reason = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    )
      .bind(why, ts, ts, entry.id)
      .run();
    if (result.meta.changes === 0) return c.json({ error: "This entry changed while you were looking at it. Reload and try again." }, 409);
    await audit(c.env, "reject", `entry:${entry.id}`, { reason: why }).run();
    const entriesLeft = Math.max(0, CONTEST.maxEntriesPerEntrant - (await activeCountFor(c.env, entry.entrant_id)));
    c.executionCtx.waitUntil(sendEmail(c.env, templates.entryRejected(entry.email, { title: entry.title, reason: why, entriesLeft })));
    return c.json({ ok: true });
  }

  return c.json({ error: "decision must be approve or reject" }, 400);
});

/**
 * Takes a song out of the competition. Disqualify = broke the rules (only an
 * approved song); withdraw = the entrant asked (any song still in play).
 * No automatic email: Patrick contacts them personally. Files leave the
 * public prefix, and a library copy (Creator Spotlight Show) is archived.
 */
const removeEntry = (action: "disqualify" | "withdraw") => async (c: Ctx) => {
  const entry = await loadEntry(c.env, c.req.param("id") ?? "");
  if (!entry) return c.json({ error: "not found" }, 404);
  const allowed = action === "disqualify" ? ["approved"] : ["unconfirmed", "pending", "approved"];
  if (!allowed.includes(entry.status)) return c.json({ error: `A ${entry.status} entry can't be ${action === "disqualify" ? "disqualified" : "withdrawn"}.` }, 409);
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const why = String(reason ?? "").trim();
  if (!why) return c.json({ error: "Please note a reason (for your records - it isn't emailed)." }, 400);

  const newStatus = action === "disqualify" ? "disqualified" : "withdrawn";
  const ts = nowIso();
  const updateRow = (audioKey: string, photoKey: string | null) =>
    c.env.DB.prepare(
      `UPDATE contest_entries SET status = ?, status_reason = ?, audio_key = ?, photo_key = ?, updated_at = ?
       WHERE id = ? AND status = ?`
    ).bind(newStatus, why, audioKey, photoKey, ts, entry.id, entry.status);

  // Only an approved song's files are public; pending ones already sit out of reach.
  const done =
    entry.status === "approved"
      ? await moveEntryFiles(c.env, entry, "removed", updateRow)
      : (await updateRow(entry.audio_key, entry.photo_key).run()).meta.changes > 0;
  if (!done) return c.json({ error: "This entry changed while you were looking at it. Reload and try again." }, 409);

  await audit(c.env, action, `entry:${entry.id}`, { reason: why, from: entry.status }).run();
  if (entry.status === "approved") await clearStateCache(c.env);

  // The Creator Spotlight copy stops being playable; warn if a published show still uses it.
  let inPublishedProgrammes: { id: string; title: string }[] = [];
  if (entry.library_track_id) {
    await c.env.DB.prepare("UPDATE tracks SET status = 'archived', updated_at = ? WHERE id = ?").bind(ts, entry.library_track_id).run();
    inPublishedProgrammes = (
      await c.env.DB.prepare(
        `SELECT DISTINCT p.id, p.title FROM programme_items pi JOIN programmes p ON p.id = pi.programme_id
         WHERE pi.track_id = ? AND p.status = 'published'`
      )
        .bind(entry.library_track_id)
        .all<{ id: string; title: string }>()
    ).results;
  }
  return c.json({ ok: true, inPublishedProgrammes });
};
contestStudioRoutes.post("/entries/:id/disqualify", removeEntry("disqualify"));
contestStudioRoutes.post("/entries/:id/withdraw", removeEntry("withdraw"));

/**
 * "Add to library": makes an approved entry available to the Programme
 * Builder for the weekly Creator Spotlight Show. The new track is 'ready',
 * never 'published' - every public catalogue, album, search and mood query
 * only selects published tracks, so contest songs never show up in the
 * catalogue, while a published programme plays its items whatever each
 * track's own status (checked before building this).
 */
contestStudioRoutes.post("/entries/:id/add-to-library", async (c) => {
  const entry = await loadEntry(c.env, c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  if (entry.status !== "approved") return c.json({ error: "Only approved songs can be added to the library." }, 409);
  if (entry.library_track_id) return c.json({ ok: true, trackId: entry.library_track_id, alreadyAdded: true });

  const trackId = newId("trk");
  const ts = nowIso();
  const TAG = "creator-contest";
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tracks (id, title, artist, duration_seconds, audio_url, artwork_url, description, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'ready', ?, ?)`
    ).bind(
      trackId,
      entry.title,
      entry.creator_name,
      entry.duration_seconds ?? 0,
      entry.audio_key,
      entry.photo_key,
      `Top 3 Creator Songs of 2026 - Song #${entry.id}`,
      ts,
      ts
    ),
    c.env.DB.prepare("INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING").bind(newId("tag"), TAG),
    c.env.DB.prepare("INSERT INTO track_tags (track_id, tag_id) SELECT ?, id FROM tags WHERE name = ?").bind(trackId, TAG),
    c.env.DB.prepare("UPDATE contest_entries SET library_track_id = ?, updated_at = ? WHERE id = ?").bind(trackId, ts, entry.id),
    audit(c.env, "add_to_library", `entry:${entry.id}`, { trackId }),
  ]);
  return c.json({ ok: true, trackId });
});

// ------------------------------------------------------------------ stats

contestStudioRoutes.get("/stats", async (c) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [byStatus, byCountry, perDay, notify] = await Promise.all([
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM contest_entries GROUP BY status").all<{ status: string; n: number }>(),
    c.env.DB.prepare(
      "SELECT country_code AS code, COUNT(*) AS n FROM contest_entries WHERE status = 'approved' GROUP BY country_code ORDER BY n DESC"
    ).all<{ code: string; n: number }>(),
    c.env.DB.prepare(
      "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM contest_entries WHERE created_at >= ? GROUP BY day ORDER BY day"
    )
      .bind(since)
      .all<{ day: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN confirmed_at IS NOT NULL AND unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN confirmed_at IS NULL AND unsubscribed_at IS NULL THEN 1 ELSE 0 END) AS unconfirmed,
         SUM(CASE WHEN confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND wants_news = 1 THEN 1 ELSE 0 END) AS wants_news,
         SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed
       FROM contest_notify`
    ).first<Record<string, number | null>>(),
  ]);
  return c.json({
    byStatus: Object.fromEntries(byStatus.results.map((r) => [r.status, r.n])),
    approvedByCountry: byCountry.results,
    perDay: perDay.results,
    notify: {
      confirmed: notify?.confirmed ?? 0,
      unconfirmed: notify?.unconfirmed ?? 0,
      wantsNews: notify?.wants_news ?? 0,
      unsubscribed: notify?.unsubscribed ?? 0,
    },
  });
});

// ------------------------------------------------------------------ export

// Every entry with its entrant's details, for Patrick's own records. Cells
// that a spreadsheet would treat as a formula (=, +, -, @) get a leading
// apostrophe, so an entrant can't plant one in a title.
contestStudioRoutes.get("/export.csv", async (c) => {
  const { results } = await c.env.DB.prepare(`${ENTRY_SELECT} ORDER BY e.id`).all<EntryRow>();
  const columns: (keyof EntryRow | "links")[] = [
    "id", "status", "title", "creator_name", "country_code", "created_or_released", "duration_seconds", "audio_bytes",
    "legal_name", "email", "ai_tools", "collecting_society", "bio", "links", "status_reason",
    "created_at", "confirmed_at", "reviewed_at", "approved_at", "library_track_id",
  ];
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const r of results) {
    const row = { ...r, links: parseLinks(r.links_json).join(" ") } as Record<string, unknown>;
    lines.push(columns.map((col) => cell(row[col])).join(","));
  }
  await audit(c.env, "export_csv", "entries", { rows: results.length }).run();
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="top3-entries-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
});
