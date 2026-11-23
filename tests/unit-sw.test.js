// The app's service worker (frontend/public/sw.js), run against a fake worker environment — no browser needed.
//
// What matters here is the UPGRADE: the worker serves the app shell from a cache, so right after an update the
// page that is open was served by the PREVIOUS version. That has to be fixed by reloading it once, but only then:
// a normal start must not reload anything.
//
//   node --test tests/unit-sw.test.js        (Node 20+)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'sw.js'), 'utf8');

/** Loads sw.js into a sandbox that behaves like a service-worker global, and hands back its listeners and fakes. */
function boot({ existingCaches = [], clients = [], navigateFails = false } = {}) {
  const listeners = {};
  const cacheStore = new Map(existingCaches.map((n) => [n, new Map()]));
  const navigated = [];
  const claimed = { value: false };

  const sandbox = {
    self: {
      location: { origin: 'https://app.example' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => Promise.resolve(),
      clients: {
        claim: async () => { claimed.value = true; },
        matchAll: async () =>
          clients.map((url) => ({
            url,
            navigate: (to) => (navigateFails ? Promise.reject(new Error('client is closing')) : (navigated.push(to), Promise.resolve())),
          })),
      },
    },
    caches: {
      keys: async () => [...cacheStore.keys()],
      delete: async (name) => cacheStore.delete(name),
      open: async (name) => {
        if (!cacheStore.has(name)) cacheStore.set(name, new Map());
        const store = cacheStore.get(name);
        return { add: async () => {}, put: async (req, res) => { store.set(req.url || req, res); }, match: async (req) => store.get(req.url || req) };
      },
    },
    URL,
    fetch: async () => ({ ok: true, clone() { return this; } }),
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  /** Fires an ExtendableEvent and waits for what the handler passed to waitUntil. */
  async function fire(type) {
    let pending;
    listeners[type]({ waitUntil: (p) => { pending = p; } });
    await pending;
  }
  return { fire, cacheStore, navigated, claimed, listeners };
}

test('upgrading from an older version deletes its cache and reloads the open page once', async () => {
  const sw = boot({ existingCaches: ['quarc-weather-v1'], clients: ['https://app.example/city/abc'] });
  await sw.fire('activate');
  assert.deepEqual([...sw.cacheStore.keys()], [], 'the old cache must be gone (the current one is created on install)');
  assert.equal(sw.claimed.value, true, 'the new worker must take over the open page');
  assert.deepEqual(sw.navigated, ['https://app.example/city/abc'], 'the open page must be reloaded where it is');
});

test('every open window is reloaded, not just one', async () => {
  const sw = boot({ existingCaches: ['quarc-weather-v1'], clients: ['https://app.example/', 'https://app.example/settings'] });
  await sw.fire('activate');
  assert.equal(sw.navigated.length, 2);
});

test('a normal start (nothing old to replace) reloads nothing', async () => {
  const sw = boot({ existingCaches: ['quarc-weather-v2'], clients: ['https://app.example/'] });
  await sw.fire('activate');
  assert.deepEqual(sw.navigated, [], 'a page must not be reloaded when no older version was running');
  assert.deepEqual([...sw.cacheStore.keys()], ['quarc-weather-v2'], 'the current cache must be kept');
});

test('a first ever install (no caches at all) reloads nothing', async () => {
  const sw = boot({ existingCaches: [], clients: ['https://app.example/'] });
  await sw.fire('activate');
  assert.deepEqual(sw.navigated, []);
});

test('a page that cannot be navigated (e.g. it is closing) does not break activation', async () => {
  const sw = boot({ existingCaches: ['quarc-weather-v1'], clients: ['https://app.example/'], navigateFails: true });
  await assert.doesNotReject(sw.fire('activate'));
  assert.deepEqual([...sw.cacheStore.keys()], [], 'the old cache is still removed');
});

test('cross-origin and API requests are never answered by the worker (forecasts must not be cached)', async () => {
  const sw = boot();
  for (const url of ['https://api.open-meteo.com/v1/forecast?x=1', 'https://nominatim.openstreetmap.org/reverse', 'https://app.example/api/sync/pull']) {
    let responded = false;
    sw.listeners.fetch({ request: { method: 'GET', url }, respondWith: () => { responded = true; } });
    assert.equal(responded, false, `the worker answered ${url}`);
  }
});

test('same-origin app files are answered by the worker', async () => {
  const sw = boot();
  let responded = false;
  sw.listeners.fetch({ request: { method: 'GET', url: 'https://app.example/assets/index-abc.js' }, respondWith: () => { responded = true; } });
  assert.equal(responded, true);
});
