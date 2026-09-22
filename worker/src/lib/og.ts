import type { Env } from "./types";

/**
 * Open Graph / Twitter Card meta tags for a shareable page (handoff:
 * shareable links). WhatsApp, Facebook, Slack and the like fetch a page to
 * build its link preview without running any JavaScript, so these have to be
 * present in the initial HTML response - added here, server-side, rather
 * than by React after the app has loaded. See routes/shareLinks.ts for the
 * per-page tag building; this file only has the plumbing.
 */
export interface OgTags {
  title: string;
  description: string;
  /** Absolute URL, or null to omit og:image/twitter:image entirely. */
  image: string | null;
  /** The canonical absolute URL for this page. */
  url: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Every track/album/channel/mood page is served through the same fetch of "/" that
// the plain SPA catch-all in index.ts uses (see its comment on why "/" rather than
// "/index.html") - this just splices meta tags into that same shell before returning
// it, so the client boots and takes over exactly as it does everywhere else.
export async function pageWithOg(env: Env, request: Request, tags: OgTags): Promise<Response> {
  const shellUrl = new URL(request.url);
  shellUrl.pathname = "/";
  shellUrl.search = "";
  const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
  if (!shell.ok) return shell;
  let html = await shell.text();

  // index.html carries its own static og:/twitter: tags as the site-wide
  // default (for pages this router doesn't cover, e.g. the homepage or a
  // programme). Strip them here so a track/album/channel/mood page's real
  // tags replace them rather than sitting alongside as duplicates.
  html = html.replace(/[ \t]*<meta (property="og:|name="twitter:)[^>]*\/>\n?/g, "");

  const block = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="We Are Radio" />`,
    `<meta property="og:title" content="${esc(tags.title)}" />`,
    `<meta property="og:description" content="${esc(tags.description)}" />`,
    `<meta property="og:url" content="${esc(tags.url)}" />`,
    tags.image ? `<meta property="og:image" content="${esc(tags.image)}" />` : null,
    `<meta name="twitter:card" content="${tags.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(tags.title)}" />`,
    `<meta name="twitter:description" content="${esc(tags.description)}" />`,
    tags.image ? `<meta name="twitter:image" content="${esc(tags.image)}" />` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n    ");

  // The shell's own <title> is the one fixed string this replaces; everything else is added alongside it.
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(tags.title)}</title>\n    ${block}`);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/** An R2 key (as stored on tracks/albums/channels) turned into an absolute, publicly fetchable URL - or an already-absolute URL left as-is. */
export function absoluteMedia(request: Request, key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return `${new URL(request.url).origin}/media/${key}`;
}

/** The site's own fallback image, for a page with no artwork of its own. */
export function defaultImage(request: Request): string {
  return `${new URL(request.url).origin}/hero-video-poster.jpg`;
}
