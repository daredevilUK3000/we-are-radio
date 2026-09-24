import { Hono } from "hono";
import type { Env } from "../lib/types";
import { streamR2Object } from "../lib/stream";

export const mediaRoutes = new Hono<{ Bindings: Env }>();

// Streams tracks/audio assets straight out of R2 (Range handling in lib/stream.ts).
mediaRoutes.get("/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ""));

  // Top 3 contest files: only approved songs may be played by the public.
  // An entry's audio and photo sit under contest/pending/ until the Studio
  // approves it (so nobody can hear an unreviewed upload, even with the key)
  // and move to contest/removed/ if it's later disqualified or withdrawn.
  // The Studio hears pending songs through its own authenticated route.
  if (key.startsWith("contest/") && !key.startsWith("contest/approved/")) return c.notFound();

  // Approved contest files can still be withdrawn later, so they're only
  // cached for an hour rather than a year.
  const cacheControl = key.startsWith("contest/") ? "public, max-age=3600" : "public, max-age=31536000, immutable";
  const res = await streamR2Object(c.env.MEDIA, key, c.req.header("Range"), cacheControl);
  return res ?? c.notFound();
});
