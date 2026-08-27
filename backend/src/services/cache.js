// Tiny in-memory TTL cache. Open-Meteo has no hard quota, but a household of
// users all watching the same few cities would otherwise re-fetch identical
// forecasts every few seconds. Forecast data only updates every ~15 min
// upstream, so caching costs nothing in freshness.

const store = new Map();

function get(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Wraps an async producer so concurrent callers for the same key share one
// upstream request instead of stampeding.
const inflight = new Map();

async function through(key, ttlMs, produce) {
  const cached = get(key);
  if (cached) return cached;

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const value = await produce();
      set(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

// Bound memory in case a lot of distinct coordinates get queried.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now > v.expires) store.delete(k);
}, 5 * 60 * 1000).unref();

module.exports = { get, set, through };
