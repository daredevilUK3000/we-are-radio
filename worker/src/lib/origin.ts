import type { Context, Next } from "hono";
import type { Env } from "./types";

/**
 * The site-wide CORS setting in index.ts reflects any origin with
 * credentials allowed, which other flows may rely on, so it's left alone for
 * now (it deserves its own review). The contest, likes and Studio contest
 * routes don't wait for that: every request that changes something must come
 * from one of our own pages, so another website can't submit entries, likes
 * or review decisions using a visitor's (or the Studio's) cookies.
 *
 * Browsers always send Origin on POST/PATCH/DELETE, so a missing header
 * means a script or tool, not a person on our site - refused as well.
 */
const ALLOWED_ORIGINS = ["https://weareradio.app", "https://kizzi-radio-api.kizzi.workers.dev"];
// Local development: the Vite dev server (:5173) or `wrangler dev` serving the built app on any port.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

// An Origin identical to the address the request was made to is same-origin
// by definition. That also covers `wrangler dev`, which rewrites both the URL
// and the Origin header to http://weareradio.app (the custom-domain route).
export function isAllowedOrigin(origin: string | undefined, requestUrl: string): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin) || origin === new URL(requestUrl).origin;
}

export async function requireSameOrigin(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
  if (!isAllowedOrigin(c.req.header("Origin"), c.req.url)) {
    return c.json({ error: "bad_origin", message: "This request has to come from the We Are Radio website." }, 403);
  }
  await next();
}
