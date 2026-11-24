// The Windows app carries its own copy of the page (served from tauri.localhost): it is always the current version and
// opens offline by itself, so a worker there only ever does harm. This one kept answering with the PREVIOUS version's
// page after an update, whose script files are no longer inside the app — and the window stayed blank. So in the app
// the worker removes itself and everything it cached, and reloads the open page once. (A browser, the phone app and
// the Mac/Linux windows onto the server use the worker below, unchanged.)
if (self.location.hostname === 'tauri.localhost') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
        await self.registration.unregister();
        const pages = await self.clients.matchAll({ type: 'window' });
        for (const page of pages) page.navigate(page.url).catch(() => {});
      })()
    );
  });
} else {
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
      (async () => {
        const stale = (await caches.keys()).filter((k) => k !== CACHE_NAME);
        await Promise.all(stale.map((k) => caches.delete(k)));
        await self.clients.claim();

        // An older version of this worker was running, so the page that is open right now was served from ITS cache —
        // that is, it is the PREVIOUS version of the app. Left alone it would keep running until the next launch,
        // and an old app against a changed server is a broken app (this matters most for an update that moves the
        // app's data handling, like the one to direct weather fetching). Reload the open pages once, now.
        if (stale.length) {
          const pages = await self.clients.matchAll({ type: 'window' });
          for (const page of pages) page.navigate(page.url).catch(() => {});
        }
      })()
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
}
