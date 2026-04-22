// ShredTrack Service Worker — focused on caching the Race Timer for offline use

const CACHE_NAME = "shredtrack-timer-v1";

// Pre-cache the timer page shell and key assets on install
const PRECACHE_URLS = [
  "/insights/hyrox/timer",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Clean up old caches
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // For the timer page and its JS/CSS assets: network-first, fall back to cache
  const isTimerPage = url.pathname.startsWith("/insights/hyrox/timer");
  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.match(/\.(js|css|woff2?|png|svg|ico)$/);

  if (isTimerPage || isStaticAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline — serve from cache
          return caches.match(request).then(
            (cached) =>
              cached ||
              new Response("Offline — page not cached", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              }),
          );
        }),
    );
  }

  // For API routes (practice race saves) — let them fail naturally;
  // the app handles offline saves via localStorage queuing.
});
