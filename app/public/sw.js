// Replaces the old workbox-generated service worker, which started
// breaking navigation for real visitors after a deploy changed the
// underlying asset hashes. Browsers check this exact URL for updates
// over the network directly (bypassing whatever the currently-active
// worker's fetch handler does), so once a browser with the old worker
// notices this file changed, it installs this one, which immediately
// wipes every cache, unregisters itself, and reloads any open tabs -
// after that, the site is served straight from the network again with
// no service worker involved at all.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
