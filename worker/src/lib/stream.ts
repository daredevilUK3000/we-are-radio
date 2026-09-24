/**
 * Streams one R2 object as an HTTP response, with Range support - some
 * browsers (Safari in particular) require a working Range response for
 * <audio>/<video> playback to work at all, not just for seeking. Shared by
 * the public /media/* route and the Studio's contest audio/photo preview, so
 * the Range handling lives in one place.
 */

function parseRange(header: string): R2Range | undefined {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return undefined;
  const start = Number(match[1]);
  const endStr = match[2];
  return endStr ? { offset: start, length: Number(endStr) - start + 1 } : { offset: start };
}

export async function streamR2Object(
  bucket: R2Bucket,
  key: string,
  rangeHeader: string | undefined,
  cacheControl: string
): Promise<Response | null> {
  const range = rangeHeader ? parseRange(rangeHeader) : undefined;

  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) return null;

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", cacheControl);

  if (object.range && "offset" in object.range && "length" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
