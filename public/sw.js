// Versioned cache — bump CACHE_VERSION on every release so old assets evict.
const CACHE_VERSION = "v4";
const CACHE_NAME = `mealprep-${CACHE_VERSION}`;

// We don't know the hashed asset filenames at SW build time, so we cache on
// first fetch (stale-while-revalidate) instead of pre-caching a manifest.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      // Return cached immediately if we have it, otherwise wait for the network.
      return cached || network;
    }),
  );
});
