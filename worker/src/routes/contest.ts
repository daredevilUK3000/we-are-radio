import { Hono, type Context } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { isValidSession } from "../lib/auth";
import { requireSameOrigin } from "../lib/origin";
import { CONTEST, SHUFFLE_MODULUS, canLikeContestSongs, contestPhase, shuffleMultiplier } from "../lib/contest";
import { constantTimeEqual, emailHash, ipHash, randomToken, tokenHash, unsubscribeSig } from "../lib/hash";
import { verifyTurnstile } from "../lib/turnstile";
import { sendEmail, templates } from "../lib/email";
import { isCountryCode } from "../lib/countries";

/**
 * Top 3 Creator Songs of 2026 - the public side of the entry phase (Phase A).
 * Mounted at /api/contest BEFORE the listener sub-app in index.ts: that
 * sub-app's sign-in check applies to every /api/* route registered after it.
 *
 * Nothing here ever returns an entrant's legal name, email, AI-tools or
 * collecting-society declarations, a rejection reason, or like counts - only
 * approved songs' public details. Contact details live in contest_entrants,
 * which the public SELECTs below never join.
 */
export const contestPublicRoutes = new Hono<{ Bindings: Env }>();
contestPublicRoutes.use("*", requireSameOrigin);

type Ctx = Context<{ Bindings: Env }>;

const clientIp = (c: Ctx) => c.req.header("cf-connecting-ip") ?? "unknown";
const fail = (c: Ctx, status: 400 | 403 | 404 | 409 | 413 | 429 | 503, error: string, message: string, field?: string) =>
  c.json({ error, message, ...(field ? { field } : {}) }, status);

// -------------------------------------------------------------- rate limits

// Counters in KV, one key per window (the Time Capsule pattern in public.ts).
// Approximate by nature - KV is eventually consistent - which is fine for
// throttling: the hard rules (entries per person) are enforced in D1.
interface Limit {
  key: string;
  max: number;
  ttl: number;
}
const hourWindow = () => new Date().toISOString().slice(0, 13);
const dayWindow = () => new Date().toISOString().slice(0, 10);

async function overLimit(env: Env, limits: Limit[]): Promise<{ over: boolean; counts: number[] }> {
  const counts = await Promise.all(limits.map(async (l) => Number((await env.CONFIG.get(l.key)) ?? 0)));
  return { over: counts.some((n, i) => n >= limits[i].max), counts };
}
async function bump(env: Env, limits: Limit[], counts: number[]) {
  await Promise.all(limits.map((l, i) => env.CONFIG.put(l.key, String(counts[i] + 1), { expirationTtl: l.ttl })));
}

// ---------------------------------------------------------------- housekeeping

// Entries nobody confirmed within 7 days are deleted, files and all. Run from
// GET /state at most once an hour (a KV timestamp guards it), so Phase A
// needs no cron trigger.
const SWEEP_KEY = "contest:sweep";
const CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function sweepUnconfirmed(env: Env) {
  const last = Number((await env.CONFIG.get(SWEEP_KEY)) ?? 0);
  if (Date.now() - last < 60 * 60 * 1000) return;
  await env.CONFIG.put(SWEEP_KEY, String(Date.now()));

  const cutoff = new Date(Date.now() - CONFIRM_WINDOW_MS).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id, audio_key, photo_key FROM contest_entries WHERE status = 'unconfirmed' AND created_at < ? LIMIT 200"
  )
    .bind(cutoff)
    .all<{ id: number; audio_key: string; photo_key: string | null }>();
  if (results.length === 0) return;

  const keys = results.flatMap((r) => [r.audio_key, r.photo_key]).filter((k): k is string => !!k);
  await env.MEDIA.delete(keys);
  await env.DB.batch([
    ...results.map((r) => env.DB.prepare("DELETE FROM contest_entries WHERE id = ? AND status = 'unconfirmed'").bind(r.id)),
    env.DB.prepare("INSERT INTO contest_audit (actor, action, target, detail_json, created_at) VALUES ('system', 'sweep_unconfirmed', NULL, ?, ?)").bind(
      JSON.stringify({ entries: results.map((r) => r.id) }),
      nowIso()
    ),
  ]);
}

// ------------------------------------------------------------------ state

const STATE_KEY = "contest:state";

contestPublicRoutes.get("/state", async (c) => {
  const phase = await contestPhase(c.env);

  type Counts = { approvedCount: number; countryCount: number; byCountry: { code: string; n: number }[] };
  let counts = (await c.env.CONFIG.get(STATE_KEY, "json")) as Counts | null;
  if (!counts) {
    const { results } = await c.env.DB.prepare(
      "SELECT country_code AS code, COUNT(*) AS n FROM contest_entries WHERE status = 'approved' GROUP BY country_code ORDER BY n DESC, code"
    ).all<{ code: string; n: number }>();
    counts = { approvedCount: results.reduce((sum, r) => sum + r.n, 0), countryCount: results.length, byCountry: results };
    await c.env.CONFIG.put(STATE_KEY, JSON.stringify(counts), { expirationTtl: 60 });
  }

  c.executionCtx.waitUntil(sweepUnconfirmed(c.env).catch((err) => console.error("contest sweep failed", err)));

  // The Studio can try the whole entry flow before 1 October (see POST /entries).
  const studioPreview =
    phase === "before_entries" && (await isValidSession(c.req.header("Cookie"), c.env.SESSION_SECRET, "studio"));

  return c.json({
    phase,
    dates: {
      entriesOpen: CONTEST.entriesOpen,
      entriesClose: CONTEST.entriesClose,
      votingOpen: CONTEST.votingOpen,
      votingClose: CONTEST.votingClose,
      eligibleFrom: CONTEST.eligibleFrom,
      eligibleTo: CONTEST.eligibleTo,
    },
    limits: {
      maxEntriesPerEntrant: CONTEST.maxEntriesPerEntrant,
      maxAudioBytes: CONTEST.maxAudioBytes,
      maxPhotoBytes: CONTEST.maxPhotoBytes,
      maxDurationSeconds: CONTEST.maxDurationSeconds,
    },
    likesOpen: canLikeContestSongs(phase),
    studioPreview,
    ...counts,
  });
});

// ---------------------------------------------------------------- browse

interface PublicEntryRow {
  id: number;
  title: string;
  creator_name: string;
  country_code: string;
  photo_key: string | null;
  audio_key: string;
  duration_seconds: number | null;
}

// photo_url / audio_url carry the R2 key, the same convention as tracks.audio_url:
// the app turns them into /media/... links with mediaUrl().
const publicEntry = (r: PublicEntryRow) => ({
  id: r.id,
  title: r.title,
  creator_name: r.creator_name,
  country_code: r.country_code,
  photo_url: r.photo_key,
  audio_url: r.audio_key,
  duration_seconds: r.duration_seconds,
});

contestPublicRoutes.get("/entries", async (c) => {
  const country = (c.req.query("country") ?? "").toUpperCase();
  const offset = Math.max(0, Math.floor(Number(c.req.query("cursor") ?? 0)) || 0);
  const limit = Math.min(50, Math.max(1, Math.floor(Number(c.req.query("limit") ?? 24)) || 24));

  let sql = `SELECT id, title, creator_name, country_code, photo_key, audio_key, duration_seconds
             FROM contest_entries WHERE status = 'approved'`;
  const params: unknown[] = [];
  if (country && isCountryCode(country)) {
    sql += " AND country_code = ?";
    params.push(country);
  }
  // Daily shuffle: fair to unknown creators, stable all day so paging never repeats a song.
  sql += ` ORDER BY ((id * ?) % ${SHUFFLE_MODULUS}), id LIMIT ? OFFSET ?`;
  params.push(shuffleMultiplier(), limit + 1, offset);

  const { results } = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<PublicEntryRow>();
  const more = results.length > limit;
  return c.json({ entries: results.slice(0, limit).map(publicEntry), nextCursor: more ? String(offset + limit) : null });
});

contestPublicRoutes.get("/entries/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return fail(c, 404, "not_found", "We couldn't find that song.");
  // Approved only - a pending or rejected entry is a plain 404, so nobody can tell it exists.
  const row = await c.env.DB.prepare(
    `SELECT id, title, creator_name, country_code, photo_key, audio_key, duration_seconds, bio, links_json, approved_at
     FROM contest_entries WHERE id = ? AND status = 'approved'`
  )
    .bind(id)
    .first<PublicEntryRow & { bio: string | null; links_json: string | null; approved_at: string | null }>();
  if (!row) return fail(c, 404, "not_found", "We couldn't find that song.");

  let links: string[] = [];
  try {
    links = row.links_json ? JSON.parse(row.links_json) : [];
  } catch {
    links = [];
  }
  return c.json({ entry: { ...publicEntry(row), bio: row.bio, links, approved_at: row.approved_at } });
});

// ----------------------------------------------------------------- submit

type Sniffed = { contentType: string; ext: string };

// Only the file's first bytes are trusted, never its name or the browser's
// stated type: a renamed .wav or .exe is refused.
function sniffMp3(b: Uint8Array): boolean {
  if (b.length < 3) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true; // "ID3" tag
  return b[0] === 0xff && (b[1] & 0xe0) === 0xe0; // MPEG frame sync
}
function sniffImage(b: Uint8Array): Sniffed | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v))
    return { contentType: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { contentType: "image/webp", ext: "webp" };
  return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECLARATIONS = ["confirm_age", "confirm_independent", "confirm_rights", "confirm_licence", "accept_rules"];

// Checks what someone typed. Returns the cleaned values, or the first problem
// with a friendly message and the field it belongs to (the form shows it there).
function validateFields(get: (name: string) => string, getAll: (name: string) => string[]) {
  type Err = { ok: false; error: string; message: string; field: string };
  const err = (field: string, message: string, error = "invalid_field"): Err => ({ ok: false, error, message, field });

  const title = get("title").trim();
  if (title.length < 1 || title.length > 120) return err("title", "Please give your song a title (up to 120 characters).");
  const creator_name = get("creator_name").trim();
  if (creator_name.length < 1 || creator_name.length > 80) return err("creator_name", "Please enter your creator name (up to 80 characters).");
  const country_code = get("country_code").trim().toUpperCase();
  if (!isCountryCode(country_code)) return err("country_code", "Please choose your country.");

  const created_or_released = get("created_or_released").trim();
  const realDate = DATE_PATTERN.test(created_or_released) && !Number.isNaN(Date.parse(`${created_or_released}T12:00:00Z`)) &&
    new Date(`${created_or_released}T12:00:00Z`).toISOString().slice(0, 10) === created_or_released;
  if (!realDate) return err("created_or_released", "Please enter the date your song was created or first released.");
  if (created_or_released < CONTEST.eligibleFrom || created_or_released > CONTEST.eligibleTo)
    return err("created_or_released", "Songs must have been created or first released in 2026.", "not_eligible_date");

  let duration_seconds: number | null = null;
  const rawDuration = get("duration_seconds").trim();
  if (rawDuration) {
    const d = Math.round(Number(rawDuration));
    if (!Number.isFinite(d) || d < 1) return err("audio", "We couldn't read how long your song is. Please try another MP3.");
    if (d > CONTEST.maxDurationSeconds) return err("audio", "Songs can be up to 8 minutes long.", "too_long");
    duration_seconds = d;
  }

  const ai_tools = get("ai_tools").trim() || null;
  if (ai_tools && ai_tools.length > 200) return err("ai_tools", "Please keep the AI tools answer under 200 characters.");
  const collecting_society = get("collecting_society").trim() || null;
  if (collecting_society && collecting_society.length > 60) return err("collecting_society", "Please keep the society name under 60 characters.");

  const legal_name = get("legal_name").trim();
  if (legal_name.length < 1 || legal_name.length > 120) return err("legal_name", "Please enter your full legal name.");
  const email = get("email").trim();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return err("email", "Please enter a valid email address.");

  const bio = get("bio").trim() || null;
  if (bio && bio.length > 300) return err("bio", "Please keep your bio to 300 characters.");

  const links = getAll("links").map((l) => l.trim()).filter(Boolean);
  if (links.length > 3) return err("links", "You can add up to 3 links.");
  for (const link of links) {
    let ok = false;
    try {
      ok = link.length <= 300 && new URL(link).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) return err("links", "Links must be full web addresses starting with https:// (up to 300 characters).");
  }

  for (const d of DECLARATIONS) {
    if (get(d) !== "1") return err(d, "Please tick all five declarations to enter.", "declarations_required");
  }

  return {
    ok: true as const,
    value: { title, creator_name, country_code, created_or_released, duration_seconds, ai_tools, collecting_society, legal_name, email, bio, links },
  };
}

contestPublicRoutes.post("/entries", async (c) => {
  // 20 MB of audio plus 5 MB of photo plus the form itself; anything bigger is refused before reading it.
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > 26 * 1024 * 1024) return fail(c, 413, "too_large", "Your files are too big. Songs can be up to 20 MB and photos up to 5 MB.", "audio");

  // Entries open on 1 October (Paris). Before that only a Studio session may
  // submit, so the whole flow can be tested in production before launch.
  const phase = await contestPhase(c.env);
  const isStudio = await isValidSession(c.req.header("Cookie"), c.env.SESSION_SECRET, "studio");
  if (phase !== "entries_open" && !(phase === "before_entries" && isStudio)) {
    return fail(c, 409, "entries_closed",
      phase === "before_entries" ? "Entries open on 1 October 2026." : "Entries closed on 31 March 2027. Thank you to everyone who entered.");
  }

  // Per-address limit for the public; the Studio (Patrick testing) isn't throttled.
  const who = await ipHash(c.env, clientIp(c));
  const limits: Limit[] = isStudio
    ? []
    : [
        { key: `contest:rl:entry:${who}:h:${hourWindow()}`, max: 5, ttl: 60 * 60 * 2 },
        { key: `contest:rl:entry:${who}:d:${dayWindow()}`, max: 20, ttl: 60 * 60 * 26 },
      ];
  const rate = await overLimit(c.env, limits);
  if (rate.over) return fail(c, 429, "rate_limited", "You've sent a few entries already. Please try again a little later.");

  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    return fail(c, 400, "bad_request", "Something went wrong sending the form. Please try again.");
  }
  const first = (name: string) => {
    const v = body[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const get = (name: string) => {
    const v = first(name);
    return typeof v === "string" ? v : "";
  };
  const getAll = (name: string) => {
    const v = body[name];
    return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
  };

  // A real person never sees this field; a form-filling bot does. Pretend it worked.
  if (get("website").trim() !== "") return c.json({ ok: true }, 201);

  const human = await verifyTurnstile(c.env, get("turnstileToken"), "entry", c.req.raw);
  if (!human.ok) return fail(c, human.status, human.error, human.message, "turnstile");

  const checked = validateFields(get, getAll);
  if (!checked.ok) return fail(c, 400, checked.error, checked.message, checked.field);
  const v = checked.value;

  const audio = first("audio");
  if (!(audio instanceof File) || audio.size === 0) return fail(c, 400, "audio_required", "Please choose your song's MP3 file.", "audio");
  if (audio.size > CONTEST.maxAudioBytes) return fail(c, 413, "too_large", "Songs can be up to 20 MB.", "audio");
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  if (!sniffMp3(audioBytes.subarray(0, 4))) return fail(c, 400, "not_mp3", "That file isn't an MP3. Please upload your song as an MP3.", "audio");

  const photo = first("photo");
  let photoBytes: Uint8Array | null = null;
  let photoType: Sniffed | null = null;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > CONTEST.maxPhotoBytes) return fail(c, 413, "too_large", "Photos can be up to 5 MB.", "photo");
    photoBytes = new Uint8Array(await photo.arrayBuffer());
    photoType = sniffImage(photoBytes.subarray(0, 12));
    if (!photoType) return fail(c, 400, "bad_photo", "Photos must be a JPEG, PNG or WebP image.", "photo");
  }

  // One person, CONTEST.maxEntriesPerEntrant songs still in play (rejected and
  // withdrawn ones don't count). Checked here to avoid storing files for nothing, and
  // again inside the insert itself so two entries sent at once can't both slip in.
  const hash = await emailHash(c.env, v.email);
  const ACTIVE_COUNT = `(SELECT COUNT(*) FROM contest_entries e JOIN contest_entrants p ON p.id = e.entrant_id
                         WHERE p.email_hash = ? AND e.status NOT IN ('withdrawn','rejected'))`;
  const active = await c.env.DB.prepare(`SELECT ${ACTIVE_COUNT} AS n`).bind(hash).first<{ n: number }>();
  const limitMessage =
    CONTEST.maxEntriesPerEntrant === 1
      ? "You've already entered a song. Each creator can enter one song."
      : `You've already entered ${CONTEST.maxEntriesPerEntrant} songs.`;
  if ((active?.n ?? 0) >= CONTEST.maxEntriesPerEntrant) return fail(c, 409, "entry_limit", limitMessage, "email");

  // Files are stored under our own random names - never the uploaded filename.
  const uuid = crypto.randomUUID();
  const audioKey = `contest/pending/audio/${uuid}.mp3`;
  const photoKey = photoType ? `contest/pending/photos/${uuid}.${photoType.ext}` : null;
  await c.env.MEDIA.put(audioKey, audioBytes, { httpMetadata: { contentType: "audio/mpeg" } });
  if (photoKey && photoBytes && photoType) {
    await c.env.MEDIA.put(photoKey, photoBytes, { httpMetadata: { contentType: photoType.contentType } });
  }
  const removeFiles = () => c.env.MEDIA.delete([audioKey, ...(photoKey ? [photoKey] : [])]).catch(() => {});

  const token = randomToken();
  const ts = nowIso();
  let songNumber: number | null = null;
  try {
    const [, inserted] = await c.env.DB.batch([
      // Latest typed name and address win, so a changed email or a corrected name sticks.
      c.env.DB.prepare(
        `INSERT INTO contest_entrants (id, legal_name, email, email_hash, created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(email_hash) DO UPDATE SET legal_name = excluded.legal_name, email = excluded.email`
      ).bind(newId("ent"), v.legal_name, v.email, hash, ts),
      // Song numbers start at 101 and are handed out in this one statement, so two can't clash.
      c.env.DB.prepare(
        `INSERT INTO contest_entries
           (id, entrant_id, title, creator_name, country_code, created_or_released, ai_tools, collecting_society,
            bio, links_json, photo_key, audio_key, audio_bytes, duration_seconds, status, confirm_token_hash,
            created_at, updated_at)
         SELECT COALESCE((SELECT MAX(id) FROM contest_entries), 100) + 1,
                (SELECT id FROM contest_entrants WHERE email_hash = ?),
                ?,?,?,?,?,?,?,?,?,?,?,?, 'unconfirmed', ?, ?, ?
         WHERE ${ACTIVE_COUNT} < ?
         RETURNING id`
      ).bind(
        hash,
        v.title, v.creator_name, v.country_code, v.created_or_released, v.ai_tools, v.collecting_society,
        v.bio, v.links.length ? JSON.stringify(v.links) : null, photoKey, audioKey, audioBytes.length, v.duration_seconds,
        await tokenHash(c.env, token), ts, ts,
        hash, CONTEST.maxEntriesPerEntrant
      ),
    ]);
    songNumber = (inserted.results?.[0] as { id?: number } | undefined)?.id ?? null;
  } catch (err) {
    console.error("contest entry insert failed", err);
    await removeFiles();
    return fail(c, 503, "try_again", "Something went wrong saving your entry. Please try again in a minute.");
  }
  if (songNumber === null) {
    await removeFiles();
    return fail(c, 409, "entry_limit", limitMessage, "email");
  }

  c.executionCtx.waitUntil(bump(c.env, limits, rate.counts));
  c.executionCtx.waitUntil(sendEmail(c.env, templates.entryConfirm(v.email, { title: v.title, token })));
  return c.json({ ok: true }, 201);
});

// ---------------------------------------------------------------- confirm

// The emailed link opens /top3/confirm in the app, which POSTs the token here.
// A plain GET link would be "clicked" by corporate mail scanners and confirm
// entries nobody asked for.
//
// Once used, the stored hash is kept with a "used:" prefix: it can never
// confirm anything again, but a second click is recognised and answered
// kindly ("already confirmed") instead of looking like a broken link.
contestPublicRoutes.post("/entries/confirm", async (c) => {
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
  const badLink = () => fail(c, 404, "bad_token", "This confirmation link isn't valid. It may have expired: links work for 7 days.");
  if (!token || token.length > 200) return badLink();

  const h = await tokenHash(c.env, token);
  const entry = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.status, e.created_at, e.confirm_token_hash, p.email
     FROM contest_entries e JOIN contest_entrants p ON p.id = e.entrant_id
     WHERE e.confirm_token_hash IN (?, ?)`
  )
    .bind(h, `used:${h}`)
    .first<{ id: number; title: string; status: string; created_at: string; confirm_token_hash: string; email: string }>();
  if (!entry) return badLink();

  if (entry.confirm_token_hash.startsWith("used:") || entry.status !== "unconfirmed") {
    return c.json({ ok: true, alreadyConfirmed: true, title: entry.title });
  }
  if (Date.now() - Date.parse(entry.created_at) > CONFIRM_WINDOW_MS) return badLink();

  const ts = nowIso();
  const updated = await c.env.DB.prepare(
    `UPDATE contest_entries SET status = 'pending', confirm_token_hash = ?, confirmed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'unconfirmed'`
  )
    .bind(`used:${h}`, ts, ts, entry.id)
    .run();
  // Two clicks at the same moment: only the one that changed the row sends the email.
  if (updated.meta.changes > 0) {
    c.executionCtx.waitUntil(sendEmail(c.env, templates.entryReceived(entry.email, { title: entry.title })));
    return c.json({ ok: true, title: entry.title });
  }
  return c.json({ ok: true, alreadyConfirmed: true, title: entry.title });
});

// ------------------------------------------------ remind me when voting opens

// Double opt-in: nothing is sent to this list (bar the confirm email itself)
// until the address owner clicks the link. The response is identical whether
// the address is new, already on the list, or quietly throttled, so the form
// can't be used to find out who has signed up.
const NOTIFY_ACCEPTED = { ok: true, message: "Check your email to confirm." };
const NEWS_UPGRADE_KEY = (h: string) => `contest:notify-news:${h}`;

contestPublicRoutes.post("/notify", async (c) => {
  const body = await c.req
    .json<{ email?: string; entryId?: number | string; wantsNews?: boolean; turnstileToken?: string; website?: string }>()
    .catch(() => ({}) as Record<string, never>);

  if (String(body.website ?? "").trim() !== "") return c.json(NOTIFY_ACCEPTED, 202);

  const who = await ipHash(c.env, clientIp(c));
  const ipLimits: Limit[] = [{ key: `contest:rl:notify:${who}:h:${hourWindow()}`, max: 10, ttl: 60 * 60 * 2 }];
  const ipRate = await overLimit(c.env, ipLimits);
  if (ipRate.over) return fail(c, 429, "rate_limited", "Too many sign-ups from here. Please try again a little later.");

  const email = String(body.email ?? "").trim();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return fail(c, 400, "invalid_field", "Please enter a valid email address.", "email");

  const human = await verifyTurnstile(c.env, body.turnstileToken, "notify", c.req.raw);
  if (!human.ok) return fail(c, human.status, human.error, human.message, "turnstile");
  c.executionCtx.waitUntil(bump(c.env, ipLimits, ipRate.counts));

  const hash = await emailHash(c.env, email);
  const emailLimits: Limit[] = [{ key: `contest:rl:notify-email:${hash}:d:${dayWindow()}`, max: 3, ttl: 60 * 60 * 26 }];
  const emailRate = await overLimit(c.env, emailLimits);
  if (emailRate.over) return c.json(NOTIFY_ACCEPTED, 202);
  c.executionCtx.waitUntil(bump(c.env, emailLimits, emailRate.counts));

  const entryId = Number(body.entryId);
  const sourceEntry = Number.isInteger(entryId) && entryId > 0 ? entryId : null;
  const wantsNews = body.wantsNews === true ? 1 : 0;
  const token = randomToken();
  const th = await tokenHash(c.env, token);

  const existing = await c.env.DB.prepare(
    "SELECT id, wants_news, confirmed_at, unsubscribed_at FROM contest_notify WHERE email_hash = ?"
  )
    .bind(hash)
    .first<{ id: string; wants_news: number; confirmed_at: string | null; unsubscribed_at: string | null }>();

  let id: string;
  if (!existing) {
    id = newId("ntf");
    await c.env.DB.prepare(
      `INSERT INTO contest_notify (id, email, email_hash, source_entry_id, wants_voting_alert, wants_news, confirm_token_hash, created_at)
       VALUES (?,?,?,?,1,?,?,?) ON CONFLICT(email_hash) DO NOTHING`
    )
      .bind(id, email, hash, sourceEntry, wantsNews, th, nowIso())
      .run();
  } else if (existing.confirmed_at && !existing.unsubscribed_at) {
    // Already on the list. Only a newly ticked "send me news" needs anything:
    // news is a separate consent, so it waits for this address to confirm it.
    id = existing.id;
    if (!wantsNews || existing.wants_news) return c.json(NOTIFY_ACCEPTED, 202);
    await c.env.DB.prepare("UPDATE contest_notify SET confirm_token_hash = ? WHERE id = ?").bind(th, id).run();
    await c.env.CONFIG.put(NEWS_UPGRADE_KEY(th), "1", { expirationTtl: 7 * 24 * 60 * 60 });
  } else {
    // Never confirmed, or unsubscribed and signing up again: start over with a fresh link.
    id = existing.id;
    await c.env.DB.prepare(
      `UPDATE contest_notify SET email = ?, source_entry_id = COALESCE(?, source_entry_id), wants_news = ?,
         confirm_token_hash = ?, confirmed_at = NULL, unsubscribed_at = NULL WHERE id = ?`
    )
      .bind(email, sourceEntry, wantsNews, th, id)
      .run();
  }

  const unsubscribeUrl = `https://weareradio.app/top3/unsubscribe?id=${encodeURIComponent(id)}&sig=${await unsubscribeSig(c.env, id)}`;
  c.executionCtx.waitUntil(sendEmail(c.env, templates.notifyConfirm(email, { token, unsubscribeUrl })));
  return c.json(NOTIFY_ACCEPTED, 202);
});

contestPublicRoutes.post("/notify/confirm", async (c) => {
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
  const badLink = () => fail(c, 404, "bad_token", "This link isn't valid any more. You can sign up again on the Top 3 page.");
  if (!token || token.length > 200) return badLink();

  const h = await tokenHash(c.env, token);
  const row = await c.env.DB.prepare("SELECT id, confirm_token_hash FROM contest_notify WHERE confirm_token_hash IN (?, ?)")
    .bind(h, `used:${h}`)
    .first<{ id: string; confirm_token_hash: string }>();
  if (!row) return badLink();
  // A second click changes nothing - and must not undo a later unsubscribe.
  if (row.confirm_token_hash.startsWith("used:")) return c.json({ ok: true });

  const newsUpgrade = await c.env.CONFIG.get(NEWS_UPGRADE_KEY(h));
  await c.env.DB.prepare(
    `UPDATE contest_notify SET confirmed_at = COALESCE(confirmed_at, ?), unsubscribed_at = NULL,
       wants_news = CASE WHEN ? THEN 1 ELSE wants_news END, confirm_token_hash = ? WHERE id = ?`
  )
    .bind(nowIso(), newsUpgrade ? 1 : 0, `used:${h}`, row.id)
    .run();
  if (newsUpgrade) c.executionCtx.waitUntil(c.env.CONFIG.delete(NEWS_UPGRADE_KEY(h)));
  return c.json({ ok: true });
});

contestPublicRoutes.post("/notify/unsubscribe", async (c) => {
  const { id, sig } = await c.req.json<{ id?: string; sig?: string }>().catch(() => ({}) as { id?: string; sig?: string });
  if (!id || !sig || id.length > 64 || !constantTimeEqual(sig, await unsubscribeSig(c.env, id))) {
    return fail(c, 404, "bad_link", "This unsubscribe link isn't valid. Please use the link from your most recent email.");
  }
  await c.env.DB.prepare("UPDATE contest_notify SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE id = ?")
    .bind(nowIso(), id)
    .run();
  return c.json({ ok: true });
});
