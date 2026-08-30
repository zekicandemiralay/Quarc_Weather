// End-to-end exercise of the Quarc Weather API against a locally running
// backend. Mints its own JWT with the same secret the server was started with,
// standing in for what quarc-auth would issue in production.

const jwt = require('jsonwebtoken');

const BASE = 'http://127.0.0.1:3904';
const SECRET = process.env.JWT_SECRET || 'testsecret';
const token = jwt.sign({ id: 'user-test-1', username: 'zeki', role: 'admin' }, SECRET, { expiresIn: '1h' });
const authed = { headers: { Cookie: `token=${token}`, 'Content-Type': 'application/json' } };

let pass = 0;
let fail = 0;

function ok(name, extra = '') {
  console.log(`  [ OK ]  ${name}${extra ? '  — ' + extra : ''}`);
  pass++;
}
function bad(name, detail) {
  console.log(`  [FAIL]  ${name}  — ${detail}`);
  fail++;
}

async function check(name, fn) {
  try {
    const msg = await fn();
    ok(name, msg);
  } catch (err) {
    bad(name, err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log('\nQuarc Weather — API test\n========================\n');

  console.log('Auth gate');
  await check('GET /api/health is public', async () => {
    const r = await fetch(`${BASE}/api/health`);
    const j = await r.json();
    assert(r.status === 200, `status ${r.status}`);
    assert(j.service === 'quarc-weather-backend', `service was ${j.service}`);
    return j.service;
  });

  for (const path of ['/api/cities', '/api/weather?lat=41&lon=29', '/api/prefs', '/api/geocode/search?q=istanbul']) {
    await check(`GET ${path.split('?')[0]} rejects anonymous`, async () => {
      const r = await fetch(`${BASE}${path}`);
      assert(r.status === 401, `expected 401, got ${r.status}`);
      return '401';
    });
  }

  await check('GET /api/cities rejects a token signed with the wrong secret', async () => {
    const wrong = jwt.sign({ id: 'x', username: 'x', role: 'user' }, 'not-the-secret');
    const r = await fetch(`${BASE}/api/cities`, { headers: { Cookie: `token=${wrong}` } });
    assert(r.status === 401, `expected 401, got ${r.status}`);
    return '401';
  });

  console.log('\nPreferences');
  await check('GET /api/prefs returns defaults for a new user', async () => {
    const r = await fetch(`${BASE}/api/prefs`, authed);
    const j = await r.json();
    assert(r.status === 200, `status ${r.status}`);
    assert(j.units === 'metric', `units was ${j.units}`);
    return `${j.units}/${j.wind_unit}/${j.precip_unit}`;
  });

  await check('PUT /api/prefs persists a change', async () => {
    const r = await fetch(`${BASE}/api/prefs`, {
      ...authed,
      method: 'PUT',
      body: JSON.stringify({ units: 'imperial', language: 'tr' }),
    });
    const j = await r.json();
    assert(r.status === 200, `status ${r.status}`);
    assert(j.units === 'imperial' && j.language === 'tr', `got ${j.units}/${j.language}`);
    return 'imperial/tr';
  });

  await check('PUT /api/prefs rejects an invalid value', async () => {
    const r = await fetch(`${BASE}/api/prefs`, { ...authed, method: 'PUT', body: JSON.stringify({ units: 'kelvin' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    return '400';
  });

  // Put units back so the forecast assertions below read in Celsius.
  await fetch(`${BASE}/api/prefs`, { ...authed, method: 'PUT', body: JSON.stringify({ units: 'metric', language: 'en' }) });

  console.log('\nGeocoding');
  let istanbul;
  await check('GET /api/geocode/search finds Istanbul', async () => {
    const r = await fetch(`${BASE}/api/geocode/search?q=istanbul`, authed);
    const j = await r.json();
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(j) && j.length > 0, 'no results');
    istanbul = j[0];
    assert(typeof istanbul.latitude === 'number', 'missing latitude');
    return `${j.length} results, first = ${istanbul.name}, ${istanbul.country}`;
  });

  await check('GET /api/geocode/search returns [] for a 1-char query', async () => {
    const r = await fetch(`${BASE}/api/geocode/search?q=i`, authed);
    const j = await r.json();
    assert(Array.isArray(j) && j.length === 0, `got ${JSON.stringify(j).slice(0, 60)}`);
    return '[]';
  });

  console.log('\nCities');
  let cityId;
  await check('POST /api/cities saves a city', async () => {
    const r = await fetch(`${BASE}/api/cities`, { ...authed, method: 'POST', body: JSON.stringify(istanbul) });
    const j = await r.json();
    assert(r.status === 201, `status ${r.status}`);
    cityId = j.id;
    assert(j.user_id === 'user-test-1', `user_id was ${j.user_id}`);
    return `${j.name} (${j.id.slice(0, 8)}…)`;
  });

  await check('POST /api/cities is idempotent for the same coordinates', async () => {
    const r = await fetch(`${BASE}/api/cities`, { ...authed, method: 'POST', body: JSON.stringify(istanbul) });
    const j = await r.json();
    assert(r.status === 200, `expected 200 (existing), got ${r.status}`);
    assert(j.id === cityId, 'returned a different row');
    return 'same row returned';
  });

  await check('POST /api/cities rejects a missing latitude', async () => {
    const r = await fetch(`${BASE}/api/cities`, { ...authed, method: 'POST', body: JSON.stringify({ name: 'Nowhere' }) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    return '400';
  });

  await check('POST /api/cities rejects out-of-range coordinates', async () => {
    const r = await fetch(`${BASE}/api/cities`, {
      ...authed,
      method: 'POST',
      body: JSON.stringify({ name: 'Bad', latitude: 999, longitude: 0 }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    return '400';
  });

  let berlinId;
  await check('POST /api/cities saves a second city', async () => {
    const r = await fetch(`${BASE}/api/cities`, {
      ...authed,
      method: 'POST',
      body: JSON.stringify({ name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 }),
    });
    const j = await r.json();
    assert(r.status === 201, `status ${r.status}`);
    berlinId = j.id;
    return `sort_order ${j.sort_order}`;
  });

  await check('GET /api/cities lists both in sort order', async () => {
    const r = await fetch(`${BASE}/api/cities`, authed);
    const j = await r.json();
    assert(j.length === 2, `expected 2, got ${j.length}`);
    assert(j[0].id === cityId, 'wrong first city');
    return j.map((c) => c.name).join(', ');
  });

  await check('PUT /api/cities/reorder swaps them', async () => {
    const r = await fetch(`${BASE}/api/cities/reorder`, {
      ...authed,
      method: 'PUT',
      body: JSON.stringify({ ids: [berlinId, cityId] }),
    });
    assert(r.status === 200, `status ${r.status}`);
    const after = await (await fetch(`${BASE}/api/cities`, authed)).json();
    assert(after[0].id === berlinId, 'order did not change');
    return after.map((c) => c.name).join(', ');
  });

  await check("another user's list is empty (isolation)", async () => {
    const other = jwt.sign({ id: 'user-test-2', username: 'someone', role: 'user' }, SECRET, { expiresIn: '1h' });
    const r = await fetch(`${BASE}/api/cities`, { headers: { Cookie: `token=${other}` } });
    const j = await r.json();
    assert(j.length === 0, `expected 0, got ${j.length}`);
    return '0 cities';
  });

  console.log('\nForecast');
  await check('GET /api/weather returns a full bundle', async () => {
    const r = await fetch(`${BASE}/api/weather?lat=${istanbul.latitude}&lon=${istanbul.longitude}`, authed);
    const j = await r.json();
    assert(r.status === 200, `status ${r.status}`);
    assert(j.current && typeof j.current.temperature_2m === 'number', 'missing current.temperature_2m');
    assert(j.hourly?.time?.length > 24, 'hourly too short');
    assert(j.daily?.time?.length === 11, `daily length ${j.daily?.time?.length}, expected 11`);
    assert(typeof j.current.visibility === 'number', 'missing current.visibility');
    assert(j.moon && typeof j.moon.illumination === 'number', 'missing moon');
    return `${j.current.temperature_2m}${j.current_units.temperature_2m}, ${j.daily.time.length} days, moon ${j.moon.phase}`;
  });

  await check('daily[1] is today in the city timezone', async () => {
    const r = await fetch(`${BASE}/api/weather?lat=${istanbul.latitude}&lon=${istanbul.longitude}`, authed);
    const j = await r.json();
    const todayThere = new Date().toLocaleDateString('en-CA', { timeZone: j.timezone });
    assert(j.daily.time[1] === todayThere, `daily[1]=${j.daily.time[1]} but today is ${todayThere}`);
    return `${j.daily.time[1]} (${j.timezone})`;
  });

  await check('air quality is attached', async () => {
    const r = await fetch(`${BASE}/api/weather?lat=${istanbul.latitude}&lon=${istanbul.longitude}`, authed);
    const j = await r.json();
    assert(j.air_quality?.current, 'no air_quality block');
    return `European AQI ${j.air_quality.current.european_aqi}`;
  });

  await check('imperial preference changes the returned units', async () => {
    await fetch(`${BASE}/api/prefs`, { ...authed, method: 'PUT', body: JSON.stringify({ units: 'imperial' }) });
    const r = await fetch(`${BASE}/api/weather?lat=${istanbul.latitude}&lon=${istanbul.longitude}`, authed);
    const j = await r.json();
    assert(j.current_units.temperature_2m === '°F', `got ${j.current_units.temperature_2m}`);
    await fetch(`${BASE}/api/prefs`, { ...authed, method: 'PUT', body: JSON.stringify({ units: 'metric' }) });
    return '°F';
  });

  await check('GET /api/weather rejects a non-numeric lat', async () => {
    const r = await fetch(`${BASE}/api/weather?lat=abc&lon=29`, authed);
    assert(r.status === 400, `expected 400, got ${r.status}`);
    return '400';
  });

  await check('GET /api/weather/overview covers every saved city', async () => {
    const r = await fetch(`${BASE}/api/weather/overview`, authed);
    const j = await r.json();
    assert(j.length === 2, `expected 2, got ${j.length}`);
    for (const c of j) {
      assert(c.current, `${c.name} has no current block`);
      assert(c.today && typeof c.today.temperature_2m_max === 'number', `${c.name} missing today max`);
    }
    return j.map((c) => `${c.name} ${Math.round(c.current.temperature_2m)}°`).join(', ');
  });

  console.log('\nCaching');
  await check('a repeat forecast is served from cache (much faster)', async () => {
    const url = `${BASE}/api/weather?lat=48.8566&lon=2.3522`;
    const t1 = Date.now();
    await fetch(url, authed);
    const cold = Date.now() - t1;
    const t2 = Date.now();
    await fetch(url, authed);
    const warm = Date.now() - t2;
    assert(warm < cold, `warm ${warm}ms was not faster than cold ${cold}ms`);
    return `cold ${cold}ms → warm ${warm}ms`;
  });

  console.log('\nCleanup');
  await check('DELETE /api/cities/:id removes a city', async () => {
    const r = await fetch(`${BASE}/api/cities/${berlinId}`, { ...authed, method: 'DELETE' });
    assert(r.status === 200, `status ${r.status}`);
    const after = await (await fetch(`${BASE}/api/cities`, authed)).json();
    assert(after.length === 1, `expected 1 left, got ${after.length}`);
    return '1 city left';
  });

  await check("DELETE of another user's city 404s", async () => {
    const other = jwt.sign({ id: 'user-test-2', username: 'someone', role: 'user' }, SECRET, { expiresIn: '1h' });
    const r = await fetch(`${BASE}/api/cities/${cityId}`, { method: 'DELETE', headers: { Cookie: `token=${other}` } });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    return '404';
  });

  console.log('\n========================');
  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
