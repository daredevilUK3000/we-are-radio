import { Hono, type Context } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { requireSameOrigin } from "../lib/origin";
import { emailHash, ipHash } from "../lib/hash";
import { verifyTurnstile } from "../lib/turnstile";
import { sendEmail, contactTemplates } from "../lib/email";
import { bump, dayWindow, hourWindow, overLimit, type Limit } from "../lib/rateLimit";

/**
 * POST /api/contact - the "Talk to the studio" page (/contact).
 *
 * Mounted BEFORE the listener sub-app in index.ts, like the contest routes:
 * that sub-app's sign-in check applies to every /api/* route registered
 * after it and would turn every message into a 401.
 *
 * Each message is stored (for the Studio inbox, a later piece of work) and
 * emailed to the studio with Reply-To set to the sender. The sender gets a
 * generic confirmation that never repeats what they typed.
 */
export const contactRoutes = new Hono<{ Bindings: Env }>();
contactRoutes.use("*", requireSameOrigin);

type Ctx = Context<{ Bindings: Env }>;

/** Promised in the confirmation email; the page shows the same number (app/src/listener/pages/contact/topics.ts). */
const REPLY_DAYS = 3;
const DEFAULT_ADDRESS = "info@weareradio.app";
const DEFAULT_FROM = "We Are Radio <info@weareradio.app>";

interface FieldRule {
  label: string;
  required?: boolean;
  kind?: "https" | "date" | "number";
}
interface Topic {
  title: string;
  short: string;
  fields: Record<string, FieldRule>;
}

// Keep in step with app/src/listener/pages/contact/topics.ts.
const TOPICS: Record<string, Topic> = {
  studio: { title: "Message the studio", short: "STUDIO", fields: {} },
  request: {
    title: "Request or dedication",
    short: "REQUESTS",
    fields: { song: { label: "Song and artist", required: true }, dedicate_to: { label: "Dedicate it to" } },
  },
  top3: { title: "Top 3 competition", short: "TOP 3", fields: { song_number: { label: "Song number", kind: "number" } } },
  business: {
    title: "Sponsorship & advertising",
    short: "BUSINESS",
    fields: { company: { label: "Company", required: true }, website: { label: "Website", kind: "https" } },
  },
  press: {
    title: "Press & media",
    short: "PRESS",
    fields: { outlet: { label: "Publication or outlet", required: true }, deadline: { label: "Deadline", kind: "date" } },
  },
  problem: {
    title: "Problem with the app",
    short: "HELP",
    fields: { device: { label: "Device and browser", required: true }, page: { label: "Which page" } },
  },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LINE_BREAK = /[\r\n]/;

const fail = (c: Ctx, status: 400 | 403 | 429 | 503, error: string, message: string, field?: string) =>
  c.json({ error, message, ...(field ? { field } : {}) }, status);

interface Body {
  topic?: unknown;
  name?: unknown;
  email?: unknown;
  message?: unknown;
  fields?: unknown;
  on_air_ok?: unknown;
  page_ref?: unknown;
  turnstileToken?: unknown;
  company_url?: unknown;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

type Checked =
  | { ok: true; topic: string; name: string; email: string; message: string; fields: Record<string, string> }
  | { ok: false; error: string; message: string; field: string };

function validate(body: Body): Checked {
  const bad = (field: string, message: string, error = "invalid"): Checked => ({ ok: false, error, message, field });

  const topicKey = str(body.topic);
  const topic = Object.hasOwn(TOPICS, topicKey) ? TOPICS[topicKey] : null;
  if (!topic) return bad("topic", "Please choose what your message is about.");

  const rawName = str(body.name);
  const rawEmail = str(body.email);
  // Nothing that ends up in an email header may contain a line break.
  if (LINE_BREAK.test(rawName)) return bad("name", "Please keep your name on one line.");
  if (LINE_BREAK.test(rawEmail)) return bad("email", "Please check your email address.");
  const name = rawName.trim();
  if (name.length < 1 || name.length > 80) return bad("name", "Please tell us your name (up to 80 characters).");
  const email = rawEmail.trim();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return bad("email", "Please check your email address.");

  const message = str(body.message).trim();
  if (message.length < 10) return bad("message", "Your message is a little short. Please write at least 10 characters.");
  if (message.length > 2000) return bad("message", "Your message is too long. Please keep it under 2000 characters.");

  const given = body.fields ?? {};
  if (typeof given !== "object" || given === null || Array.isArray(given)) return bad("fields", "Something went wrong sending the form.");
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(given)) {
    if (!Object.hasOwn(topic.fields, key)) return bad(key, "That detail doesn't belong to this topic.", "unknown_field");
    if (typeof value !== "string") return bad(key, "Please check this field.");
    if (LINE_BREAK.test(value)) return bad(key, "Please keep this on one line.");
    const v = value.trim();
    if (v.length > 200) return bad(key, "Please keep this under 200 characters.");
    if (v) fields[key] = v;
  }
  for (const [key, rule] of Object.entries(topic.fields)) {
    const v = fields[key];
    if (!v) {
      if (rule.required) return bad(key, `Please fill in "${rule.label}".`);
      continue;
    }
    if (rule.kind === "number" && !/^\d{1,6}$/.test(v)) return bad(key, "Song numbers are digits only, like 142.");
    if (rule.kind === "date" && (!DATE_PATTERN.test(v) || Number.isNaN(Date.parse(v)))) return bad(key, "Please choose a date.");
    if (rule.kind === "https") {
      let url: URL | null = null;
      try {
        url = new URL(v);
      } catch {
        url = null;
      }
      if (!url || url.protocol !== "https:") return bad(key, "Please give the full address, starting with https://");
    }
  }
  return { ok: true, topic: topicKey, name, email, message, fields };
}

/** Where they came from: only a page on this site, kept as its address on weareradio.app. */
function cleanPageRef(raw: unknown, requestUrl: string): string | null {
  const value = str(raw).trim();
  if (!value || value.length > 500) return null;
  try {
    const own = new URL(requestUrl);
    const url = new URL(value, own.origin);
    if (url.hostname !== "weareradio.app" && url.hostname !== own.hostname) return null;
    return `https://weareradio.app${url.pathname}${url.search}`.slice(0, 200);
  } catch {
    return null;
  }
}

/** A first name safe to repeat in the confirmation: one word of letters, or nothing. */
function firstNameForEmail(name: string): string | null {
  const first = name.split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'’-]{0,23}$/u.test(first) ? first : null;
}

contactRoutes.post("/", async (c) => {
  const body = await c.req.json<Body>().catch(() => null);
  if (!body || typeof body !== "object") return fail(c, 400, "bad_request", "Something went wrong sending the form. Please try again.");

  // A real person never sees this field; a form-filling bot does. Pretend it worked.
  if (str(body.company_url).trim() !== "") return c.json({ ok: true }, 200);

  const who = await ipHash(c.env, c.req.header("cf-connecting-ip") ?? "unknown");
  const sender = await emailHash(c.env, str(body.email));
  const limits: Limit[] = [
    { key: `contact:rl:ip:${who}:h:${hourWindow()}`, max: 5, ttl: 60 * 60 * 2 },
    { key: `contact:rl:ip:${who}:d:${dayWindow()}`, max: 20, ttl: 60 * 60 * 26 },
    { key: `contact:rl:email:${sender}:d:${dayWindow()}`, max: 5, ttl: 60 * 60 * 26 },
  ];
  const rate = await overLimit(c.env, limits);
  if (rate.over) {
    return fail(c, 429, "rate_limited", "You've sent a few messages already. Please try again later, or email info@weareradio.app.");
  }

  const human = await verifyTurnstile(c.env, str(body.turnstileToken), "contact", c.req.raw);
  if (!human.ok) return fail(c, human.status, human.error, human.message, "turnstile");

  const v = validate(body);
  if (!v.ok) return fail(c, 400, v.error, v.message, v.field);

  const topic = TOPICS[v.topic];
  const id = newId("msg");
  const pageRef = cleanPageRef(body.page_ref, c.req.url);
  const userAgent = (c.req.header("user-agent") ?? "").slice(0, 200) || null;
  const onAirOk = body.on_air_ok === true;

  try {
    await c.env.DB.prepare(
      `INSERT INTO contact_messages (id, topic, name, email, email_hash, fields_json, message, on_air_ok, page_ref, user_agent, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        id, v.topic, v.name, v.email, sender,
        Object.keys(v.fields).length ? JSON.stringify(v.fields) : null,
        v.message, onAirOk ? 1 : 0, pageRef, userAgent, nowIso()
      )
      .run();
  } catch (err) {
    console.error("contact message insert failed", err);
    return fail(c, 503, "try_again", "Something went wrong on our side. Please try again in a minute, or email info@weareradio.app.");
  }

  c.executionCtx.waitUntil(bump(c.env, limits, rate.counts));

  const from = c.env.CONTACT_FROM || DEFAULT_FROM;
  const details = Object.entries(topic.fields)
    .filter(([key]) => v.fields[key])
    .map(([key, rule]) => [rule.label, v.fields[key]] as [string, string]);
  const toStudio = contactTemplates.toStudio(c.env.CONTACT_TO || DEFAULT_ADDRESS, {
    id,
    short: topic.short,
    topicTitle: topic.title,
    name: v.name,
    email: v.email,
    details,
    message: v.message,
    onAirOk,
    pageRef,
    device: v.topic === "problem" ? userAgent : null,
  });
  const toSender = contactTemplates.toSender(v.email, { firstName: firstNameForEmail(v.name), topicTitle: topic.title, replyDays: REPLY_DAYS });

  c.executionCtx.waitUntil(
    (async () => {
      const [studioSent] = await Promise.all([
        sendEmail(c.env, { ...toStudio, from, replyTo: v.email }),
        sendEmail(c.env, { ...toSender, from, replyTo: DEFAULT_ADDRESS }),
      ]);
      if (studioSent) await c.env.DB.prepare("UPDATE contact_messages SET emailed = 1 WHERE id = ?").bind(id).run();
    })().catch((err) => console.error("contact emails failed", err))
  );

  return c.json({ ok: true }, 201);
});

// ------------------------------------------------------------ retention

// Messages are kept for 24 months (see /privacy). Run at most once an hour,
// from the contest's GET /state, which every listener page asks for.
const SWEEP_KEY = "contact:sweep";

export async function sweepOldContactMessages(env: Env) {
  const last = Number((await env.CONFIG.get(SWEEP_KEY)) ?? 0);
  if (Date.now() - last < 60 * 60 * 1000) return;
  await env.CONFIG.put(SWEEP_KEY, String(Date.now()));

  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 24);
  await env.DB.prepare("DELETE FROM contact_messages WHERE created_at < ?").bind(cutoff.toISOString()).run();
}
