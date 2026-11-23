// v2: forecasts now come straight from the weather provider (a different origin), and v1 would have cached and
// served those. Bumping the name makes the activate handler below delete every v1 cache.
const CACHE_NAME = 'quarc-weather-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add('/').catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // This worker exists to open the APP SHELL offline — nothing else. Forecasts, city search, place names and map
  // tiles all live on OTHER origins (Open-Meteo, Nominatim, Esri, RainViewer) and must never be cached or answered
  // from here: the app does its own freshness-aware caching, with an "as of" time, and a stale forecast served
  // silently by the worker would bypass all of it.
  if (request.method !== 'GET' || request.url.includes('/api/')) return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
