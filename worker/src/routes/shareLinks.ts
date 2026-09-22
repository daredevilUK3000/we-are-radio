import { Hono } from "hono";
import type { Env } from "../lib/types";
import { findNeed } from "../lib/needs";
import { pageWithOg, absoluteMedia, defaultImage } from "../lib/og";

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
