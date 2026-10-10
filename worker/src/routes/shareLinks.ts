import { Hono } from "hono";
import type { Env } from "../lib/types";
import { findNeed } from "../lib/needs";
import { pageWithOg, absoluteMedia, defaultImage } from "../lib/og";
import { countryFlag, countryName } from "../lib/countries";

/**
 * Shareable link previews (handoff: shareable links, ahead of the promotion
 * push). These sit in front of the plain SPA catch-all in index.ts and serve
 * the exact same app shell - just with Open Graph / Twitter Card tags filled
 * in from the database, so a link pasted into WhatsApp, Facebook or Slack
 * shows a real title, description and picture instead of a bare grey URL.
 * Nothing here changes what the app actually renders; the client takes over
 * this same shell exactly as it does for any other route.
 *
 * Radio That Knows You is the one deliberate exception (see the brief): a
 * built programme is never stored, so there's nothing to link back to -
 * /my-mood?mood=energy shares the MOOD, honestly, not a specific instance.
 */
export const shareLinkRoutes = new Hono<{ Bindings: Env }>();

const siteDefault = (request: Request) => ({
  title: "We Are Radio",
  description: "Kizzi's personal radio network - live channels, mood mixes, and radio that knows you.",
  image: defaultImage(request),
  url: `${new URL(request.url).origin}/`,
});

const canonical = (request: Request, search = "") => {
  const url = new URL(request.url);
  url.search = search;
  return url.toString();
};

shareLinkRoutes.get("/track/:id", async (c) => {
  const track = await c.env.DB.prepare(
    `SELECT t.title, t.artist, t.artwork_url, a.title AS album_title, a.artwork_url AS album_artwork_url
     FROM tracks t LEFT JOIN albums a ON a.id = t.album_id
     WHERE t.id = ? AND t.status = 'published'`
  )
    .bind(c.req.param("id"))
    .first<{ title: string; artist: string | null; artwork_url: string | null; album_title: string | null; album_artwork_url: string | null }>();

  if (!track) return pageWithOg(c.env, c.req.raw, siteDefault(c.req.raw));

  return pageWithOg(c.env, c.req.raw, {
    title: `${track.title}${track.artist ? ` - ${track.artist}` : ""} - We Are Radio`,
    description: track.album_title ? `From the album "${track.album_title}", on We Are Radio.` : "Listen on We Are Radio.",
    image: absoluteMedia(c.req.raw, track.artwork_url ?? track.album_artwork_url) ?? defaultImage(c.req.raw),
    url: canonical(c.req.raw),
  });
});

shareLinkRoutes.get("/albums/:id", async (c) => {
  const album = await c.env.DB.prepare("SELECT title, description, artwork_url FROM albums WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ title: string; description: string | null; artwork_url: string | null }>();

  if (!album) return pageWithOg(c.env, c.req.raw, siteDefault(c.req.raw));

  return pageWithOg(c.env, c.req.raw, {
    title: `${album.title} - We Are Radio`,
    description: album.description?.trim() || `The album "${album.title}", on We Are Radio.`,
    image: absoluteMedia(c.req.raw, album.artwork_url) ?? defaultImage(c.req.raw),
    url: canonical(c.req.raw),
  });
});

shareLinkRoutes.get("/channel/:slug", async (c) => {
  const channel = await c.env.DB.prepare(
    "SELECT name, emoji, description, artwork_url FROM channels WHERE slug = ? AND status = 'live'"
  )
    .bind(c.req.param("slug"))
    .first<{ name: string; emoji: string | null; description: string | null; artwork_url: string | null }>();

  if (!channel) return pageWithOg(c.env, c.req.raw, siteDefault(c.req.raw));

  return pageWithOg(c.env, c.req.raw, {
    title: `${channel.emoji ? channel.emoji + " " : ""}${channel.name} - We Are Radio`,
    description: channel.description?.trim() || "Live on We Are Radio.",
    image: absoluteMedia(c.req.raw, channel.artwork_url) ?? defaultImage(c.req.raw),
    url: canonical(c.req.raw),
  });
});

shareLinkRoutes.get("/my-mood", async (c) => {
  const need = findNeed(c.req.query("mood"));

  if (!need) {
    return pageWithOg(c.env, c.req.raw, {
      title: "Radio That Knows You - We Are Radio",
      description: "Tell us what you need right now, and we'll build the radio for you.",
      image: defaultImage(c.req.raw),
      url: canonical(c.req.raw, c.req.query("mood") ? `?mood=${encodeURIComponent(c.req.query("mood")!)}` : ""),
    });
  }

  return pageWithOg(c.env, c.req.raw, {
    title: `${need.emoji} ${need.label} - Radio That Knows You - We Are Radio`,
    description: `${need.blurb} - a mix picked for you on We Are Radio.`,
    image: defaultImage(c.req.raw),
    url: canonical(c.req.raw, `?mood=${need.key}`),
  });
});

shareLinkRoutes.get("/contact", (c) =>
  pageWithOg(c.env, c.req.raw, {
    title: "Talk to the studio · We Are Radio",
    description: "Requests, dedications, ideas and questions. The lines are open.",
    image: defaultImage(c.req.raw),
    url: `${new URL(c.req.raw.url).origin}/contact`,
  })
);

shareLinkRoutes.get("/schedule", (c) =>
  pageWithOg(c.env, c.req.raw, {
    title: "What's on We Are Radio",
    description: "Shows and sounds on every We Are Radio channel this week.",
    image: defaultImage(c.req.raw),
    url: `${new URL(c.req.raw.url).origin}/schedule`,
  })
);

// ---- Top 3 Creator Songs of 2026 ----
//
// One static contest image for every contest page (never the creator's own
// photo, whose shape and quality are unknown). Until Patrick uploads
// /top3-og.jpg (1200x630) to app/public, the site default is used.
async function contestImage(c: { env: Env; req: { raw: Request } }): Promise<string> {
  const url = new URL("/top3-og.jpg", c.req.raw.url);
  const res = await c.env.ASSETS.fetch(new Request(url, { method: "HEAD" }));
  return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/") ? url.toString() : defaultImage(c.req.raw);
}

const contestHomeTags = async (c: { env: Env; req: { raw: Request } }) => ({
  title: "We Are Radio's Top 3 Creator Songs of 2026",
  description: "Independent Creators from anywhere in the world. Enter your 2026 song by 31 March 2027.",
  image: await contestImage(c),
  url: `${new URL(c.req.raw.url).origin}/top3`,
});

shareLinkRoutes.get("/top3", async (c) => pageWithOg(c.env, c.req.raw, await contestHomeTags(c)));

// Digits only, so /top3/enter, /top3/rules and the confirm pages fall through to the plain SPA.
shareLinkRoutes.get("/top3/:id{[0-9]+}", async (c) => {
  const entry = await c.env.DB.prepare(
    "SELECT id, title, creator_name, country_code FROM contest_entries WHERE id = ? AND status = 'approved'"
  )
    .bind(Number(c.req.param("id")))
    .first<{ id: number; title: string; creator_name: string; country_code: string }>();

  if (!entry) return pageWithOg(c.env, c.req.raw, await contestHomeTags(c));

  return pageWithOg(c.env, c.req.raw, {
    title: `"${entry.title}" by ${entry.creator_name} (${countryFlag(entry.country_code)} ${countryName(entry.country_code)}) - Top 3 Creator Songs of 2026`,
    description: `Song #${entry.id} is in the running on We Are Radio. Listen now, and vote from 1 April 2027.`,
    image: await contestImage(c),
    url: canonical(c.req.raw),
  });
});

// ---- Say it on air ----
//
// One static image for every voice-note page (Patrick supplies
// /on-air-og.jpg, 1200x630; until then, the site default). The share page
// never shows an email, a note or a surname: only the first name and place
// the listener gave to be read on air.
async function onAirImage(c: { env: Env; req: { raw: Request } }): Promise<string> {
  const url = new URL("/on-air-og.jpg", c.req.raw.url);
  const res = await c.env.ASSETS.fetch(new Request(url, { method: "HEAD" }));
  return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/") ? url.toString() : defaultImage(c.req.raw);
}

shareLinkRoutes.get("/on-air", async (c) =>
  pageWithOg(c.env, c.req.raw, {
    title: "Send a shout out · We Are Radio",
    description: "Your voice. On the radio. Record a shout-out or a dedication, and Kizzi could play it on air.",
    image: await onAirImage(c),
    url: `${new URL(c.req.raw.url).origin}/on-air`,
  })
);

// The private listen-back page: never indexed.
shareLinkRoutes.get("/on-air/m/:id", async (c) => {
  const res = await pageWithOg(c.env, c.req.raw, {
    title: "Your message on We Are Radio",
    description: "Hear your message again.",
    image: await onAirImage(c),
    url: `${new URL(c.req.raw.url).origin}/on-air`,
  });
  const html = (await res.text()).replace("</head>", `  <meta name="robots" content="noindex, nofollow" />\n  </head>`);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow" } });
});

shareLinkRoutes.get("/on-air/:publicId{[A-Za-z0-9]{10}}", async (c) => {
  const clip = await c.env.DB.prepare(
    `SELECT m.first_name, m.place, m.kind, m.for_name, m.aired_at_ms, ch.name AS channel_name
     FROM onair_messages m JOIN audio_assets a ON a.id = m.audio_asset_id AND a.status != 'archived'
     LEFT JOIN channels ch ON ch.id = m.air_channel_id
     WHERE m.public_id = ? AND m.status = 'aired' AND m.consent_share = 1`
  )
    .bind(c.req.param("publicId"))
    .first<{ first_name: string; place: string; kind: string; for_name: string; aired_at_ms: number; channel_name: string | null }>();
  if (!clip) return pageWithOg(c.env, c.req.raw, siteDefault(c.req.raw));
  const kind = clip.kind === "dedication" && clip.for_name ? `A dedication for ${clip.for_name}` : clip.kind === "question" ? "A question for Kizzi" : "A shout-out";
  return pageWithOg(c.env, c.req.raw, {
    title: `${clip.first_name}${clip.place ? ` from ${clip.place}` : ""} was on We Are Radio`,
    description: `${kind}, on ${clip.channel_name ?? "We Are Radio"}. Listen, then send a shout out yourself.`,
    image: await onAirImage(c),
    url: canonical(c.req.raw),
  });
});

// ---- Advertising For Good ----
//
// /good and each ad's own link, /good/<slug>. One static image for all of
// them (/good-og.jpg, 1200x630, when Kizzi supplies one; until then, the site default).
async function goodImage(c: { env: Env; req: { raw: Request } }): Promise<string> {
  const url = new URL("/good-og.jpg", c.req.raw.url);
  const res = await c.env.ASSETS.fetch(new Request(url, { method: "HEAD" }));
  return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/") ? url.toString() : defaultImage(c.req.raw);
}

const goodHomeTags = async (c: { env: Env; req: { raw: Request } }) => ({
  title: "Advertising For Good · We Are Radio",
  description: "Ads that ask you to be kind, not to buy. Short messages between the songs on We Are Radio.",
  image: await goodImage(c),
  url: `${new URL(c.req.raw.url).origin}/good`,
});

shareLinkRoutes.get("/good", async (c) => pageWithOg(c.env, c.req.raw, await goodHomeTags(c)));

shareLinkRoutes.get("/good/:slug{[a-z0-9-]{1,80}}", async (c) => {
  const ad = await c.env.DB.prepare(
    "SELECT title FROM audio_assets WHERE afg_slug = ? AND afg = 1 AND afg_published = 1 AND status = 'published'"
  )
    .bind(c.req.param("slug"))
    .first<{ title: string }>();
  if (!ad) return pageWithOg(c.env, c.req.raw, await goodHomeTags(c));
  return pageWithOg(c.env, c.req.raw, {
    title: `${ad.title} · Advertising For Good · We Are Radio`,
    description: "A short message that asks you to be kind, not to buy. Have a listen, and pass it on.",
    image: await goodImage(c),
    url: `${new URL(c.req.raw.url).origin}/good/${c.req.param("slug")}`,
  });
});
