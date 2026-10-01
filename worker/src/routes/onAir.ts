import { Hono, type Context } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { requireSameOrigin } from "../lib/origin";
import { constantTimeEqual, emailHash, ipHash, tokenHash } from "../lib/hash";
import { verifyTurnstile } from "../lib/turnstile";
import { onAirTemplates, sendEmail } from "../lib/email";
import { bump, dayWindow, hourWindow, overLimit, type Limit } from "../lib/rateLimit";
import {
  MAX_UPLOAD_BYTES, MIN_SECONDS, SERVER_MAX_SECONDS, anonymise, deleteAudio, loadMessage, manageToken, manageTokenHash, manageUrl,
  parseWav, removeFromSchedule, shareUrl, validTimeZone, type OnAirRow,
} from "../lib/onAir";

/**
 * "Say it on air", the public side (handoff_say_it_on_air.md §4.1, §6.5, §9).
 *
 * Mounted at /api/on-air BEFORE the listener sub-app in index.ts, like the
 * contest and contact routes: that sub-app's sign-in check applies to every
 * /api/* route registered after it and would turn every message into a 401.
 *
 * Nothing here ever returns an email, email hash, IP hash, the private note
 * or the raw recording's key. The raw upload goes to onair/pending/, which
 * /media refuses to serve.
 */
export const onAirPublicRoutes = new Hono<{ Bindings: Env }>();
onAirPublicRoutes.use("*", requireSameOrigin);

type Ctx = Context<{ Bindings: Env }>;

const fail = (c: Ctx, status: 400 | 403 | 404 | 409 | 413 | 429 | 503, error: string, message: string, field?: string) =>
  c.json({ error, message, ...(field ? { field } : {}) }, status);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINE_BREAK = /[\r\n]/;
const KINDS = ["shoutout", "dedication", "reaction", "question"] as const;
const PER_EMAIL_PER_DAY = 3;

onAirPublicRoutes.post("/", async (c) => {
  // 3 MB of audio plus the form; anything much bigger is refused before reading it.
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return fail(c, 413, "too_large", "That recording is too big. Please record up to 45 seconds.", "audio");

  let body: Record<string, string | File>;
  try {
    body = (await c.req.parseBody()) as Record<string, string | File>;
  } catch {
    return fail(c, 400, "bad_request", "Something went wrong sending your message. Please try again.");
  }
  const get = (name: string) => (typeof body[name] === "string" ? (body[name] as string) : "");

  // The hidden spam-trap field. A real person never sees it, but phone AutoFill
  // can fill it anyway (the likely cause of a lost message on Kizzi's phone,
  // 1 Oct 2026), so it only counts against senders who also fail the real-person check.
  const trapped = get("hp_field").trim() !== "" || get("company_url").trim() !== "";

  const who = await ipHash(c.env, c.req.header("cf-connecting-ip") ?? "unknown");
  const limits: Limit[] = [
    { key: `onair:rl:ip:${who}:h:${hourWindow()}`, max: 5, ttl: 60 * 60 * 2 },
    { key: `onair:rl:ip:${who}:d:${dayWindow()}`, max: 10, ttl: 60 * 60 * 26 },
  ];
  const rate = await overLimit(c.env, limits);
  if (rate.over) return fail(c, 429, "rate_limited", "You've sent a few messages already. Please try again a little later.");

  const human = await verifyTurnstile(c.env, get("turnstileToken"), "onair", c.req.raw);
  if (!human.ok) {
    // A form-filling bot: pretend it worked.
    if (trapped) return c.json({ ok: true }, 200);
    return fail(c, human.status, human.error, human.message, "turnstile");
  }
  if (trapped) console.warn("on-air: spam-trap field filled by a verified person (AutoFill?); accepted");

  // ---- fields
  const kind = get("kind") as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) return fail(c, 400, "invalid", "Please choose what your message is.", "kind");
  const one = (name: string, max: number, label: string, required = false): string | { error: string } => {
    const raw = get(name);
    if (LINE_BREAK.test(raw)) return { error: `Please keep ${label} on one line.` };
    const v = raw.trim();
    if (required && !v) return { error: `Please fill in ${label}.` };
    if (v.length > max) return { error: `Please keep ${label} under ${max} characters.` };
    return v;
  };
  const firstName = one("first_name", 40, "your first name", true);
  if (typeof firstName !== "string") return fail(c, 400, "invalid", firstName.error, "first_name");
  const place = one("place", 60, "where you're listening from");
  if (typeof place !== "string") return fail(c, 400, "invalid", place.error, "place");
  const forName = kind === "dedication" ? one("for_name", 60, "who it's for", true) : "";
  if (typeof forName !== "string") return fail(c, 400, "invalid", forName.error, "for_name");
  const note = get("note").trim();
  if (note.length > 280) return fail(c, 400, "invalid", "Please keep your note to Kizzi under 280 characters.", "note");
  const email = get("email").trim();
  if (LINE_BREAK.test(email) || email.length > 254 || !EMAIL_PATTERN.test(email)) return fail(c, 400, "invalid", "Please check your email address.", "email");
  if (get("consent_voice") !== "1" || get("consent_broadcast") !== "1") {
    return fail(c, 400, "consent_required", "Please tick both boxes so we can put you on air.", "consent");
  }
  const consentShare = get("consent_share") === "1" ? 1 : 0;

  let requestedTrack: string | null = null;
  if (kind === "dedication" && get("requested_track_id")) {
    const t = await c.env.DB.prepare("SELECT id FROM tracks WHERE id = ? AND status = 'published'").bind(get("requested_track_id")).first<{ id: string }>();
    if (!t) return fail(c, 400, "invalid", "We couldn't find that song. Please pick it again.", "requested_track_id");
    requestedTrack = t.id;
  }
  const channel = get("channel")
    ? await c.env.DB.prepare("SELECT id, slug FROM channels WHERE slug = ?").bind(get("channel")).first<{ id: string; slug: string }>()
    : null;
  if (get("channel") && !channel) return fail(c, 400, "invalid", "Something went wrong sending your message. Please try again.", "channel");

  let reactingTo: string | null = null;
  if (kind === "reaction") {
    try {
      const r = JSON.parse(get("reacting_to") || "null") as { channel?: unknown; label?: unknown; track_id?: unknown; at?: unknown } | null;
      if (r && typeof r === "object") {
        const label = typeof r.label === "string" ? r.label.slice(0, 200) : null;
        reactingTo = JSON.stringify({
          channel: typeof r.channel === "string" ? r.channel.slice(0, 64) : null,
          label,
          track_id: typeof r.track_id === "string" ? r.track_id.slice(0, 64) : null,
          at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : Date.now(),
        });
      }
    } catch {
      reactingTo = null;
    }
  }

  // ---- per-email limit (Gmail dots and +tags count as the same inbox)
  const sender = await emailHash(c.env, email);
  const today = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM onair_messages WHERE email_hash = ? AND status != 'withdrawn' AND created_at > ?"
  )
    .bind(sender, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= PER_EMAIL_PER_DAY) {
    return fail(c, 429, "daily_limit", `You've sent ${PER_EMAIL_PER_DAY} messages today. Kizzi will listen to those first: please try again tomorrow.`);
  }

  // ---- the audio, checked here rather than trusted
  const audio = body.audio;
  if (!(audio instanceof File) || audio.size === 0) return fail(c, 400, "bad_audio", "We didn't receive your recording. Please try again.", "audio");
  if (audio.size > MAX_UPLOAD_BYTES) return fail(c, 413, "too_large", "That recording is too big. Please record up to 45 seconds.", "audio");
  const bytes = await audio.arrayBuffer();
  const wav = parseWav(bytes);
  if (!wav.ok) return fail(c, 400, "bad_audio", "We couldn't read your recording. Please record it again.", "audio");
  if (wav.seconds < MIN_SECONDS) return fail(c, 400, "bad_audio", "Your recording is very short. Please record at least 3 seconds.", "audio");
  if (wav.seconds > SERVER_MAX_SECONDS) return fail(c, 400, "bad_audio", "Recordings can be up to 45 seconds.", "audio");

  const id = newId("oam");
  const rawKey = `onair/pending/${id}.wav`;
  await c.env.MEDIA.put(rawKey, bytes, { httpMetadata: { contentType: "audio/wav" } });

  // A blocked sender's message is accepted like any other (so they can't tell) and rejected at once, with no email.
  const blocked = await c.env.DB.prepare("SELECT 1 FROM onair_blocks WHERE hash IN (?, ?) LIMIT 1").bind(sender, who).first();
  const ts = nowIso();
  try {
    await c.env.DB.prepare(
      `INSERT INTO onair_messages
         (id, kind, first_name, place, for_name, requested_track_id, reacting_to_json, note, channel_id, email, email_hash, ip_hash,
          listener_tz, consent_share, raw_key, raw_seconds, status, reject_reason, manage_token_hash, created_at, updated_at, reviewed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        id, kind, firstName, place, forName, requestedTrack, reactingTo, note, channel?.id ?? null, email, sender, who,
        validTimeZone(get("listener_tz")), consentShare, rawKey, Math.round(wav.seconds * 100) / 100,
        blocked ? "rejected" : "pending", blocked ? "blocked" : null, await manageTokenHash(c.env, id), ts, ts, blocked ? ts : null
      )
      .run();
  } catch (err) {
    console.error("on-air insert failed", err);
    await c.env.MEDIA.delete(rawKey).catch(() => {});
    return fail(c, 503, "try_again", "Something went wrong on our side. Please try again in a minute.");
  }

  if (!blocked) {
    const url = await manageUrl(c.env, id);
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        ...onAirTemplates.received(email, { firstName, manageUrl: url }),
        from: c.env.CONTACT_FROM || "We Are Radio <info@weareradio.app>",
        replyTo: "info@weareradio.app",
      })
    );
  }
  // Counted only once it's been accepted, as the contest does.
  c.executionCtx.waitUntil(bump(c.env, limits, rate.counts));
  return c.json({ ok: true, id, sent_today: (today?.n ?? 0) + 1, daily_limit: PER_EMAIL_PER_DAY }, 201);
});

// ------------------------------------------------------------ manage

// The emailed link opens /on-air/manage in the app, which POSTs here: mail
// scanners follow GET links, and a GET mustn't be able to withdraw anything.
async function byToken(c: Ctx): Promise<{ m: OnAirRow; action: string } | null> {
  const body = await c.req.json<{ id?: string; token?: string; action?: string }>().catch(() => ({}) as { id?: string; token?: string; action?: string });
  if (!body.id || !body.token || body.id.length > 64 || body.token.length > 200) return null;
  const m = await loadMessage(c.env.DB, body.id);
  if (!m) return null;
  if (!constantTimeEqual(await tokenHash(c.env, body.token), m.manage_token_hash)) return null;
  // Belt and braces: the token is also re-derived, so a guessed hash can't stand in for it.
  if (!constantTimeEqual(body.token, await manageToken(c.env, m.id))) return null;
  return { m, action: body.action ?? "status" };
}

async function manageView(env: Env, m: OnAirRow) {
  const channel = m.air_channel_id ?? m.channel_id;
  const ch = channel ? await env.DB.prepare("SELECT name, slug FROM channels WHERE id = ?").bind(channel).first<{ name: string; slug: string }>() : null;
  const asset = m.audio_asset_id
    ? await env.DB.prepare("SELECT audio_url, status FROM audio_assets WHERE id = ?").bind(m.audio_asset_id).first<{ audio_url: string; status: string }>()
    : null;
  const clipLive = m.status === "aired" && asset && asset.status !== "archived";
  // What the listener sees about their own message: never Kizzi's internal flags or the reject reason.
  return {
    status: m.status === "expired" || m.status === "rejected" ? "closed" : m.status,
    first_name: m.first_name,
    kind: m.kind,
    for_name: m.for_name,
    channel: ch ? { name: ch.name, slug: ch.slug } : null,
    expected_at: m.status === "placed" ? m.expected_at_ms : null,
    aired_at: m.aired_at_ms,
    can_withdraw: ["pending", "approved", "scheduled", "placed"].includes(m.status),
    can_remove_clip: !!clipLive,
    audio_url: clipLive ? asset!.audio_url : null,
    share_url: clipLive && m.public_id ? shareUrl(m.public_id) : null,
  };
}

onAirPublicRoutes.post("/manage", async (c) => {
  const hit = await byToken(c);
  if (!hit) return fail(c, 404, "bad_link", "This link isn't valid. Please use the link from your most recent email.");
  const { m, action } = hit;
  const now = Date.now();

  if (action === "withdraw") {
    if (!["pending", "approved", "scheduled", "placed"].includes(m.status)) return c.json({ ok: true, view: await manageView(c.env, m) });
    const off = await removeFromSchedule(c.env, m, now, "Withdrawn by the listener");
    if (!off.ok) {
      return fail(c, 409, off.onAir ? "on_air" : "try_again", off.onAir ? "Your message is on air right now, so it can't be taken back." : off.message);
    }
    await c.env.DB.prepare("UPDATE onair_messages SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(nowIso(), m.id).run();
    await deleteAudio(c.env, m, { raw: true, asset: true });
    await anonymise(c.env.DB, m.id);
    return c.json({ ok: true, view: await manageView(c.env, (await loadMessage(c.env.DB, m.id))!) });
  }

  if (action === "remove_clip") {
    if (m.status === "aired") {
      await deleteAudio(c.env, m, { raw: true, asset: true });
      await c.env.DB.prepare("UPDATE onair_messages SET public_id = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), m.id).run();
    }
    return c.json({ ok: true, view: await manageView(c.env, (await loadMessage(c.env.DB, m.id))!) });
  }

  return c.json({ ok: true, view: await manageView(c.env, m) });
});

// ------------------------------------------------------- share page (P1)

// Only aired messages whose sender agreed to sharing, and only while the clip exists.
onAirPublicRoutes.get("/clip/:publicId{[A-Za-z0-9]{10}}", async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT m.first_name, m.place, m.kind, m.for_name, m.aired_at_ms, a.audio_url, ch.name AS channel_name, ch.slug AS channel_slug
     FROM onair_messages m
     JOIN audio_assets a ON a.id = m.audio_asset_id AND a.status != 'archived'
     LEFT JOIN channels ch ON ch.id = m.air_channel_id
     WHERE m.public_id = ? AND m.status = 'aired' AND m.consent_share = 1`
  )
    .bind(c.req.param("publicId"))
    .first<Record<string, unknown>>();
  if (!r) return fail(c, 404, "not_found", "This clip isn't available.");
  return c.json({ clip: r });
});
