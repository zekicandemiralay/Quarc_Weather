// The direct weather-provider client (with a fake fetch) and the city identity function that the server and the
// app must agree on. No network, no server, no browser.
//
//   node --test tests/unit-provider.test.js        (Node 20+)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const fe = (rel) => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', rel)).href);

// --- city identity: server and app must agree ----------------------------------------------

test('cityKey: the server and the app derive the SAME id from the same coordinates', async () => {
  const server = require('../backend/src/services/cityKey').cityKey;
  const { cityKey: app } = await fe('cityKey.js');
  // Fixed vectors, so a change to either implementation is a deliberate, visible one.
  assert.equal(app(41.0138, 28.9497), 'c_4101_2895');
  assert.equal(app(-33.8688, 151.2093), 'c_-3387_15121');
  assert.equal(app(0, 0), 'c_0_0');
  assert.equal(app(-0.004, -0.004), 'c_0_0', 'a tiny negative coordinate never yields "-0"');
  // And a sweep of the whole globe, including awkward rounding boundaries.
  for (let lat = -90; lat <= 90; lat += 7.3137) {
    for (let lon = -180; lon <= 180; lon += 11.9161) {
      assert.equal(app(lat, lon), server(lat, lon), `disagree at ${lat},${lon}`);
    }
  }
  for (const [lat, lon] of [[41.005, 28.995], [41.015, 28.985], [-41.005, -28.995], [52.525, 13.405], [0.005, -0.005]]) {
    assert.equal(app(lat, lon), server(lat, lon), `boundary disagreement at ${lat},${lon}`);
  }
});

test("cityKey: ids satisfy the server's id format, and places ~1 km apart share one", async () => {
  const { cityKey } = await fe('cityKey.js');
  for (const id of [cityKey(41.0138, 28.9497), cityKey(-89.99, -179.99), cityKey(89.99, 179.99)]) {
    assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
  }
  assert.equal(cityKey(41.0138, 28.9497), cityKey(41.0149, 28.9503), 'same 2-decimal cell = same city');
  assert.notEqual(cityKey(41.0138, 28.9497), cityKey(41.0338, 28.9497), '2 km apart = different city');
});

// --- the direct weather-provider client (fake fetch) ---------------------------------------------

/** A fake fetch that records every URL and answers from a route table (`needle in URL` -> reply). */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    for (const [needle, reply] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        if (reply instanceof Error) throw reply;
        const status = reply.status ?? 200;
        return { ok: status < 400, status, json: async () => reply.body, text: async () => JSON.stringify(reply.body ?? '') };
      }
    }
    throw new Error('unexpected request: ' + url);
  };
  return { impl, calls };
}

const PREFS = { units: 'metric', wind_unit: 'kmh', precip_unit: 'mm' };

function calmForecast() {
  const time = [];
  for (let i = 0; i < 72; i++) time.push(new Date(Date.UTC(2026, 5, 10, i)).toISOString().slice(0, 13) + ':00');
  const fill = (v) => time.map(() => v);
  return {
    timezone: 'UTC',
    current: { temperature_2m: 12 },
    current_units: { temperature_2m: '°C' },
    daily: { time: ['d0', 'd1'] },
    hourly_units: { temperature_2m: '°C', wind_gusts_10m: 'km/h', precipitation: 'mm' },
    hourly: { time, weather_code: fill(1), precipitation: fill(0), wind_gusts_10m: fill(10), apparent_temperature: fill(20), uv_index: fill(3), visibility: fill(24000) },
  };
}

test("provider: the forecast request carries the user's units and no custom headers", async () => {
  const { fetchForecast } = await fe('forecast/provider.js');
  const seen = [];
  const f = async (url, opts) => { seen.push({ url: String(url), opts }); return { ok: true, status: 200, json: async () => ({}) }; };
  await fetchForecast(41.01, 28.97, { units: 'imperial', wind_unit: 'mph', precip_unit: 'inch' }, f);
  const u = new URL(seen[0].url);
  assert.equal(u.host, 'api.open-meteo.com');
  assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(u.searchParams.get('precipitation_unit'), 'inch');
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.equal(u.searchParams.get('past_days'), '1', 'today stays at index 1, as the screens assume');
  assert.equal(u.searchParams.get('forecast_days'), '10');
  assert.deepEqual(Object.keys(seen[0].opts), ['signal'], 'only an abort signal — any header would force a CORS pre-flight');
  await fetchForecast(41.01, 28.97, PREFS, f);
  assert.equal(new URL(seen[1].url).searchParams.get('temperature_unit'), 'celsius');
});

test('provider: a bundle has everything the screens read — forecast, air quality, moon, alerts, freshness', async () => {
  const { fetchBundle } = await fe('forecast/provider.js');
  const { impl, calls } = fakeFetch({
    '/v1/forecast': { body: calmForecast() },
    '/v1/air-quality': { body: { current: { european_aqi: 33 } } },
  });
  const now = new Date('2026-06-10T08:30:00Z');
  const b = await fetchBundle(41.01, 28.97, PREFS, { fetchImpl: impl, now });
  assert.equal(b.current.temperature_2m, 12);
  assert.equal(b.air_quality.current.european_aqi, 33);
  assert.equal(b.fetched_at, now.getTime());
  assert.ok(b.moon && typeof b.moon.illumination === 'number', 'moon');
  assert.ok(Array.isArray(b.alerts), 'alerts is always an array');
  assert.deepEqual(b.units_preference, { units: 'metric', windUnit: 'kmh', precipUnit: 'mm' });
  assert.equal(calls.length, 2, 'one forecast call + one air-quality call');
});

test('provider: a storm in the forecast produces an alert in the bundle', async () => {
  const { fetchBundle } = await fe('forecast/provider.js');
  const fc = calmForecast();
  fc.hourly.weather_code[14] = 95;
  const { impl } = fakeFetch({ '/v1/forecast': { body: fc }, '/v1/air-quality': { body: {} } });
  const b = await fetchBundle(1, 1, PREFS, { fetchImpl: impl, now: new Date('2026-06-10T08:30:00Z') });
  assert.equal(b.alerts[0].type, 'thunderstorm');
});

test('provider: missing air quality never fails the forecast; a failed forecast does', async () => {
  const { fetchBundle, ProviderError } = await fe('forecast/provider.js');

  const noAir = fakeFetch({ '/v1/forecast': { body: calmForecast() }, '/v1/air-quality': { status: 500, body: {} } });
  assert.equal((await fetchBundle(1, 1, PREFS, { fetchImpl: noAir.impl })).air_quality, null);

  const limited = fakeFetch({ '/v1/forecast': { status: 429, body: { reason: 'rate limited' } }, '/v1/air-quality': { body: {} } });
  await assert.rejects(fetchBundle(1, 1, PREFS, { fetchImpl: limited.impl }), (e) => e instanceof ProviderError && e.status === 429);

  const offline = fakeFetch({ '/v1/forecast': new TypeError('Failed to fetch'), '/v1/air-quality': { body: {} } });
  await assert.rejects(fetchBundle(1, 1, PREFS, { fetchImpl: offline.impl }), (e) => e instanceof ProviderError && /unreachable/.test(e.message));
});

test('provider: city search ignores 1-character input and maps results for the picker', async () => {
  const { searchPlaces } = await fe('forecast/provider.js');
  const { impl, calls } = fakeFetch({
    '/v1/search': { body: { results: [{ name: 'Berlin', country: 'Germany', country_code: 'DE', admin1: 'Berlin', latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin', population: 3426354, id: 1, extra: 'x' }] } },
  });
  assert.deepEqual(await searchPlaces('b', { fetchImpl: impl }), []);
  assert.equal(calls.length, 0, 'no request for a 1-character query');
  const r = await searchPlaces('  Berlin ', { language: 'tr', fetchImpl: impl });
  assert.equal(r[0].name, 'Berlin');
  assert.equal(r[0].timezone, 'Europe/Berlin');
  assert.ok(!('extra' in r[0]), 'only the fields the app uses');
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get('name'), 'Berlin');
  assert.equal(u.searchParams.get('language'), 'tr');
  assert.deepEqual(await searchPlaces('zzzzz', { fetchImpl: fakeFetch({ '/v1/search': { body: {} } }).impl }), [], 'no results is an empty list, not an error');
});

test('provider: reverse geocoding prefers the neighbourhood and returns null when it cannot name a place', async () => {
  const { reverseGeocode } = await fe('forecast/provider.js');
  const named = fakeFetch({ nominatim: { body: { address: { suburb: 'Cankurtaran', city: 'Istanbul', state: 'Istanbul', country: 'Türkiye' } } } });
  assert.deepEqual(await reverseGeocode(41.0082, 28.9784, { language: 'en', fetchImpl: named.impl }), { name: 'Cankurtaran', admin1: 'Istanbul', country: 'Türkiye' });
  assert.equal(new URL(named.calls[0]).searchParams.get('lat'), '41.00820');

  const townOnly = fakeFetch({ nominatim: { body: { address: { town: 'Smalltown', state: 'X', country: 'Y' } } } });
  assert.equal((await reverseGeocode(1, 1, { fetchImpl: townOnly.impl })).name, 'Smalltown');

  const ocean = fakeFetch({ nominatim: { body: { error: 'Unable to geocode' } } });
  assert.equal(await reverseGeocode(0, 0, { fetchImpl: ocean.impl }), null);
  const broken = fakeFetch({ nominatim: new TypeError('Failed to fetch') });
  assert.equal(await reverseGeocode(1, 1, { fetchImpl: broken.impl }), null, 'a failed lookup never throws');
});
