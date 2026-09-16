import { Hono } from "hono";
import type { Env } from "../lib/types";

export const mediaRoutes = new Hono<{ Bindings: Env }>();

function parseRange(header: string): R2Range | undefined {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return undefined;
  const start = Number(match[1]);
  const endStr = match[2];
  return endStr ? { offset: start, length: Number(endStr) - start + 1 } : { offset: start };
}

// Streams tracks/audio assets straight out of R2, with Range support - some
// browsers (Safari in particular) require a working Range response for
// <audio>/<video> playback to work at all, not just for seeking.
mediaRoutes.get("/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ""));
  const rangeHeader = c.req.header("Range");
  const range = rangeHeader ? parseRange(rangeHeader) : undefined;

  const object = await c.env.MEDIA.get(key, range ? { range } : undefined);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");

  if (object.range && "offset" in object.range && "length" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
});
