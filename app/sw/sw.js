/*
 * We Are Radio service worker. Built into dist/sw.js by the plugin in
 * vite.config.ts, which fills in BUILD_ID and PRECACHE for each build.
 *
 * What it does, and deliberately nothing more:
 * - App shell: the built JS/CSS, icons and the page itself are stored so the
 *   app opens without a connection. Pages always come from the network first
 *   (so a new deploy is picked up straight away) and only fall back to the
 *   stored copy when offline. An earlier, generated service worker served
 *   stale pages after a deploy and broke the site - this one never does that.
 * - Offline listening: songs the listener chose to download (shared/offline.ts
 *   stores them in the "war-offline" cache) are played from that cache,
 *   including the byte-range requests audio players make when starting and
 *   seeking. Nothing else from the catalogue is ever cached.
 * - Updates: every build has its own shell cache; old ones (and anything left
 *   by the old worker) are deleted when a new build takes over. Downloads are
 *   kept - they belong to the listener, not to a build.
 */

const BUILD_ID = "__BUILD_ID__";
const PRECACHE = __PRECACHE__;
const SHELL_CACHE = `war-shell-${BUILD_ID}`;
const OFFLINE_CACHE = "war-offline";
const FONT_CACHE = "war-fonts";
const KEEP = new Set([SHELL_CACHE, OFFLINE_CACHE, FONT_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // cache: "reload" skips the browser's HTTP cache, so the shell is this build's files.
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
      await loadDownloaded();
    })()
  );
});

// URLs in the offline cache, so /media requests that aren't downloaded go
// straight to the network without the worker in the way. null = not read yet.
let downloaded = null;
async function loadDownloaded() {
  const cache = await caches.open(OFFLINE_CACHE);
  const keys = await cache.keys();
  downloaded = new Set(keys.map((req) => req.url));
}
loadDownloaded();

self.addEventListener("message", (event) => {
  // The page changed the downloads (added or removed a block).
  if (event.data === "offline-updated") event.waitUntil(loadDownloaded());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/media/")) {
      const key = url.origin + url.pathname;
      if (downloaded && !downloaded.has(key)) return;
      event.respondWith(serveMedia(request, key));
      return;
    }
    if (request.mode === "navigate") {
      event.respondWith(servePage(request));
      return;
    }
    if (PRECACHE.includes(url.pathname) || url.pathname.startsWith("/assets/")) {
      event.respondWith(serveStatic(request));
    }
    return;
  }

  // Google Fonts: keep a copy so the app looks right offline.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(serveFont(request));
  }
});

async function servePage(request) {
  try {
    return await fetch(request);
  } catch (err) {
    // Offline: every listener page is the same single-page app.
    const cache = await caches.open(SHELL_CACHE);
    const shell = await cache.match("/");
    if (shell) return shell;
    throw err;
  }
}

async function serveStatic(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  return hit ?? fetch(request);
}

async function serveFont(request) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// A downloaded song (or its artwork): answered from the offline cache, with
// a proper 206 Partial Content for range requests - audio players ask for
// byte ranges when they start and when they seek, and refuse to play a
// cached file that ignores them.
async function serveMedia(request, key) {
  const cache = await caches.open(OFFLINE_CACHE);
  const hit = await cache.match(key);
  if (!hit) return fetch(request);

  const range = request.headers.get("range");
  if (!range) return hit;

  const blob = await hit.blob();
  const size = blob.size;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start = 0;
  let end = size - 1;
  if (match) {
    if (match[1] === "" && match[2] !== "") {
      // "bytes=-500": the last 500 bytes.
      start = Math.max(0, size - Number(match[2]));
    } else {
      start = Number(match[1] || 0);
      if (match[2] !== "") end = Math.min(size - 1, Number(match[2]));
    }
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": hit.headers.get("Content-Type") || "audio/mpeg",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
