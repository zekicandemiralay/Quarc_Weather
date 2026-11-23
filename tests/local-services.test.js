// The forecast cache and the per-device "My Location" record, against an in-memory IndexedDB (fake-indexeddb)
// with fake providers and a fake clock. No network, no browser.
//
//   node --test tests/local-services.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const FRONTEND = path.join(__dirname, '..', 'frontend');
require(require.resolve('fake-indexeddb/auto', { paths: [FRONTEND] }));

const fe = (rel) => import(pathToFileURL(path.join(FRONTEND, 'src', 'lib', rel)).href);

let M;
let n = 0;
test.before(async () => {
  M = {
    localDb: await fe('localDb.js'),
    service: await fe('forecast/service.js'),
    here: await fe('here.js'),
  };
});

// ============================ forecast cache ============================

function makeService({ prefs = { units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', language: 'en' } } = {}) {
  const db = M.localDb.openDb(`svc-${n++}`);
  const clock = { t: 1_000_000_000_000 };
  const calls = [];
  const state = { fail: false, prefs: { ...prefs }, delayMs: 0 };
  const fetchBundle = async (lat, lon, p) => {
    calls.push({ lat, lon, units: p.units });
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.fail) throw new Error('provider unreachable');
    return { current: { temperature_2m: calls.length }, lat, lon, units: p.units };
  };
  const service = M.service.createForecastService(db, { fetchBundle, getPrefs: async () => state.prefs, now: () => clock.t });
  return { db, clock, calls, state, service };
}

const ISTANBUL = { id: 'c_4101_2895', latitude: 41.0138, longitude: 28.9497 };
const MIN = 60 * 1000;

test('forecast: the first request fetches and caches; a repeat within 10 minutes does not fetch again', async () => {
  const { calls, service, clock } = makeService();
  const a = await service.get(ISTANBUL);
  assert.equal(calls.length, 1);
  assert.equal(a.stale, false);
  clock.t += 9 * MIN;
  const b = await service.get(ISTANBUL);
  assert.equal(calls.length, 1, 'served from the cache');
  assert.deepEqual(b.data, a.data);
  clock.t += 2 * MIN; // now 11 minutes old
  await service.get(ISTANBUL);
  assert.equal(calls.length, 2, 'refreshed once it is older than 10 minutes');
});

test('forecast: an explicit refresh is rate-limited to once per 30 seconds per city', async () => {
  const { calls, service, clock } = makeService();
  await service.get(ISTANBUL);
  clock.t += 10 * 1000;
  await service.get(ISTANBUL, { force: true });
  assert.equal(calls.length, 1, 'a refresh 10 s after the last fetch is answered from the cache');
  clock.t += 25 * 1000; // 35 s since the fetch
  await service.get(ISTANBUL, { force: true });
  assert.equal(calls.length, 2);
});

test('forecast: when the provider cannot be reached, the last good copy is returned and flagged stale', async () => {
  const { service, state, clock } = makeService();
  const first = await service.get(ISTANBUL);
  clock.t += 30 * MIN;
  state.fail = true;
  const r = await service.get(ISTANBUL);
  assert.equal(r.stale, true);
  assert.equal(r.at, first.at, 'reports WHEN the shown data is from');
  assert.deepEqual(r.data, first.data);
  assert.ok(r.error instanceof Error);
});

test('forecast: with nothing cached and the provider unreachable, it rejects (the screen shows an error)', async () => {
  const { service, state } = makeService();
  state.fail = true;
  await assert.rejects(service.get(ISTANBUL), /unreachable/);
});

test('forecast: changing units invalidates the cache and an old-unit copy is never shown as a fallback', async () => {
  const { service, state, calls } = makeService();
  await service.get(ISTANBUL);
  state.prefs = { ...state.prefs, units: 'imperial' };
  const r = await service.get(ISTANBUL);
  assert.equal(calls.length, 2);
  assert.equal(r.data.units, 'imperial');

  state.prefs = { ...state.prefs, units: 'metric', wind_unit: 'mph' }; // wind unit counts too
  state.fail = true;
  await assert.rejects(service.get(ISTANBUL), /unreachable/, '°F data must not pose as the answer for a metric request');
});

test('forecast: a city that moved (My Location) refetches for the new coordinates', async () => {
  const { service, calls } = makeService();
  await service.get({ id: 'here', latitude: 41.0, longitude: 29.0 });
  await service.get({ id: 'here', latitude: 41.0, longitude: 29.0 });
  assert.equal(calls.length, 1);
  await service.get({ id: 'here', latitude: 52.5, longitude: 13.4 }); // same id, new place
  assert.equal(calls.length, 2);
  assert.equal(calls[1].lat, 52.5);
});

test('forecast: simultaneous requests for one city share a single fetch', async () => {
  const { service, calls, state } = makeService();
  state.delayMs = 30;
  const results = await Promise.all([service.get(ISTANBUL), service.get(ISTANBUL), service.get(ISTANBUL)]);
  assert.equal(calls.length, 1);
  assert.equal(results.length, 3);
});

test('forecast: peek returns whatever is cached (any age) for instant painting, and null for a different place', async () => {
  const { service, clock } = makeService();
  assert.equal(await service.peek(ISTANBUL), null);
  const r = await service.get(ISTANBUL);
  clock.t += 5 * 24 * 60 * MIN;
  assert.deepEqual((await service.peek(ISTANBUL)).data, r.data);
  assert.equal(await service.peek({ ...ISTANBUL, latitude: 10 }), null);
});

// ============================ My Location ============================

function makeHere() {
  const db = M.localDb.openDb(`here-${n++}`);
  const state = { fix: { latitude: 41.0082, longitude: 28.9784 }, name: { name: 'Cankurtaran', admin1: 'Istanbul', country: 'Türkiye' }, reverseCalls: 0, fixCalls: 0 };
  const here = M.here.createHere(db, {
    getPosition: async () => { state.fixCalls++; return state.fix; },
    reverse: async () => { state.reverseCalls++; return state.name; },
    now: () => new Date('2026-06-10T08:30:00Z'),
  });
  return { db, here, state };
}

test('here: the first fix is named once and stored on this device', async () => {
  const { here, state } = makeHere();
  const { record, fresh } = await here.refresh({ language: 'en' });
  assert.equal(fresh, true);
  assert.equal(record.name, 'Cankurtaran');
  assert.equal(state.reverseCalls, 1);
  const city = here.asCity(await here.get());
  assert.equal(city.id, 'here');
  assert.equal(city.is_current_location, true);
  assert.equal(city.name, 'Cankurtaran');
  assert.equal(city.latitude, 41.0082);
});

test('here: no GPS fix (permission denied) keeps the last known record and reports it as NOT fresh', async () => {
  const { here, state } = makeHere();
  await here.refresh({ language: 'en' });
  state.fix = null;
  const { record, fresh } = await here.refresh({ language: 'en' });
  assert.equal(fresh, false, 'the app must not land on an old fix as if it were live');
  assert.equal(record.name, 'Cankurtaran', 'the old record is still there to show');
});

test('here: no record ever + no fix → no card', async () => {
  const { here, state } = makeHere();
  state.fix = null;
  const { record, fresh } = await here.refresh({ language: 'en' });
  assert.equal(record, null);
  assert.equal(fresh, false);
  assert.equal(here.asCity(record), null);
});

test('here: a small move does not trigger another place-name lookup', async () => {
  const { here, state } = makeHere();
  await here.refresh({ language: 'en' });
  state.fix = { latitude: 41.0182, longitude: 28.9784 }; // ~1.1 km north
  const { record } = await here.refresh({ language: 'en' });
  assert.equal(state.reverseCalls, 1, 'still just the first lookup');
  assert.equal(record.latitude, 41.0182, 'the position itself is updated');
  assert.equal(record.name, 'Cankurtaran');
});

test('here: a big move looks the name up again', async () => {
  const { here, state } = makeHere();
  await here.refresh({ language: 'en' });
  state.fix = { latitude: 52.52, longitude: 13.405 };
  state.name = { name: 'Mitte', admin1: 'Berlin', country: 'Germany' };
  const { record } = await here.refresh({ language: 'en' });
  assert.equal(state.reverseCalls, 2);
  assert.equal(record.name, 'Mitte');
});

test('here: moved far while the name lookup is unavailable → shows coordinates, never the OLD place name', async () => {
  const { here, state } = makeHere();
  await here.refresh({ language: 'en' });
  state.fix = { latitude: 52.52, longitude: 13.405 };
  state.name = null; // lookup fails (offline)
  const { record } = await here.refresh({ language: 'en' });
  assert.equal(record.name, null);
  assert.equal(here.asCity(record).name, '52.520, 13.405', 'a coordinate label beats "Cankurtaran" in Berlin');
  // …and once the lookup works again, the real name returns without moving.
  state.name = { name: 'Mitte', admin1: 'Berlin', country: 'Germany' };
  assert.equal((await here.refresh({ language: 'en' })).record.name, 'Mitte');
});

test('here: a failed first lookup is retried on the next refresh', async () => {
  const { here, state } = makeHere();
  state.name = null;
  assert.equal((await here.refresh({ language: 'en' })).record.name, null);
  state.name = { name: 'Cankurtaran', admin1: 'Istanbul', country: 'Türkiye' };
  assert.equal((await here.refresh({ language: 'en' })).record.name, 'Cankurtaran');
  assert.equal(state.reverseCalls, 2);
});

test('here: changing the app language re-fetches the name in that language', async () => {
  const { here, state } = makeHere();
  await here.refresh({ language: 'en' });
  state.name = { name: 'Cankurtaran Mahallesi', admin1: 'İstanbul', country: 'Türkiye' };
  const { record } = await here.refresh({ language: 'tr' });
  assert.equal(state.reverseCalls, 2);
  assert.equal(record.name, 'Cankurtaran Mahallesi');
});

test('here: distance helper is about right', async () => {
  const { distanceKm } = M.here;
  const km = distanceKm({ latitude: 41.0082, longitude: 28.9784 }, { latitude: 52.52, longitude: 13.405 });
  assert.ok(km > 1700 && km < 1780, `Istanbul–Berlin was ${km.toFixed(0)} km`);
  assert.equal(distanceKm({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }), 0);
});
