// Verifies the exact HTTP shape the native Android widget will actually
// send: a bare "Cookie: token=X" header via HttpURLConnection, no Origin/
// Referer/fetch-credentials semantics a browser would normally add. Also
// checks the field names WeatherWidgetWorker.java's JSON parsing depends on
// actually exist in a real response, and that a wrong/expired token gets a
// clean 401 (the widget's "signed_out" branch depends on this exact code).

const jwt = require('jsonwebtoken');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 3904;
const SECRET = 'testsecret';
const token = jwt.sign({ id: 'widget-test-user', username: 'zeki', role: 'user' }, SECRET, { expiresIn: '1h' });

let pass = 0;
let fail = 0;
function ok(n, extra = '') { console.log(`  [ OK ]  ${n}${extra ? '  — ' + extra : ''}`); pass++; }
function bad(n, d) { console.log(`  [FAIL]  ${n}  — ${d}`); fail++; }
async function step(name, fn) {
  try { ok(name, await fn()); } catch (e) { bad(name, e.message.split('\n')[0]); }
}
function assert(c, m) { if (!c) throw new Error(m); }

// Raw Node http.request — deliberately NOT using fetch(), to match what a
// native HttpURLConnection sends: a plain Cookie header, nothing else.
function rawGet(path, cookieHeader) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path, method: 'GET', headers: cookieHeader ? { Cookie: cookieHeader } : {} },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('\nQuarc Weather — widget HTTP shape\n==================================\n');

  await step('bare Cookie header (no other headers) authenticates correctly', async () => {
    const r = await rawGet('/api/weather/overview', `token=${token}`);
    assert(r.status === 200, `status ${r.status}: ${r.body.slice(0, 150)}`);
    return '200 with just a Cookie header, exactly like HttpURLConnection sends';
  });

  await step('no cookie at all -> 401 (drives the widget\'s "signed_out" state)', async () => {
    const r = await rawGet('/api/weather/overview', null);
    assert(r.status === 401, `expected 401, got ${r.status}`);
    return '401';
  });

  await step('garbage/expired token -> 401, not a crash or 500', async () => {
    const r = await rawGet('/api/weather/overview', 'token=not-a-real-jwt');
    assert(r.status === 401, `expected 401, got ${r.status}: ${r.body.slice(0, 150)}`);
    return '401';
  });

  await step('save a city, then confirm every field the widget JSON-parses is present', async () => {
    const jar = `token=${token}`;
    const add = await rawGet('/api/weather/overview', jar); // just warms auth
    assert(add.status === 200, 'setup GET failed');

    // Add via a raw POST too, matching the same bare-header style.
    const postBody = JSON.stringify({ name: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503 });
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: HOST, port: PORT, path: '/api/cities', method: 'POST',
          headers: { Cookie: jar, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postBody) },
        },
        (res) => { res.on('data', () => {}); res.on('end', resolve); }
      );
      req.on('error', reject);
      req.write(postBody);
      req.end();
    });

    const r = await rawGet('/api/weather/overview', jar);
    const cities = JSON.parse(r.body);
    assert(cities.length === 1, `expected 1 city, got ${cities.length}`);
    const c = cities[0];

    // Exactly the fields WeatherWidgetWorker.cacheCity() reads.
    assert(typeof c.name === 'string', 'missing name');
    assert('is_current_location' in c, 'missing is_current_location');
    assert(c.current && typeof c.current.temperature_2m === 'number', 'missing current.temperature_2m');
    assert(c.current && typeof c.current.weather_code === 'number', 'missing current.weather_code');
    assert(c.current && 'is_day' in c.current, 'missing current.is_day');
    assert(c.today && typeof c.today.temperature_2m_max === 'number', 'missing today.temperature_2m_max');
    assert(c.today && typeof c.today.temperature_2m_min === 'number', 'missing today.temperature_2m_min');
    // Fields the widget's hourly strip reads (WeatherWidgetWorker.paintHourly()).
    assert(Array.isArray(c.next_hours), 'missing next_hours array');
    assert(c.next_hours.length > 0 && c.next_hours.length <= 6, `expected 1-6 next_hours, got ${c.next_hours.length}`);
    for (const h of c.next_hours) {
      assert(typeof h.time === 'string', 'next_hours entry missing time');
      assert(typeof h.weather_code === 'number', 'next_hours entry missing weather_code');
      assert(typeof h.temperature_2m === 'number', 'next_hours entry missing temperature_2m');
      assert('is_day' in h, 'next_hours entry missing is_day');
    }
    return `all widget-consumed fields present: ${c.name} ${c.current.temperature_2m}°, ${c.next_hours.length} next_hours`;
  });

  await step('next_hours is anchored to the CITY\'s own current hour, not the server\'s', async () => {
    // Regression test for a real bug: next_hours used to be sliced with
    // `new Date(iso).getTime() >= Date.now() - 1h`, which parses Open-Meteo's
    // naive local-wall-clock strings as if they were in the SERVER's own
    // timezone — silently shifting the "now" cell by the gap between the
    // server's zone and the city's zone. Istanbul is used here specifically
    // because it almost never matches a server's default zone (UTC), so this
    // would have caught the bug regardless of where the test runner sits.
    const jar = `token=${token}`;
    const postBody = JSON.stringify({ name: 'Istanbul', country: 'Turkey', latitude: 41.0082, longitude: 28.9784 });
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: HOST, port: PORT, path: '/api/cities', method: 'POST',
          headers: { Cookie: jar, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postBody) },
        },
        (res) => { res.on('data', () => {}); res.on('end', resolve); }
      );
      req.on('error', reject);
      req.write(postBody);
      req.end();
    });

    const r = await rawGet('/api/weather/overview', jar);
    const cities = JSON.parse(r.body);
    const istanbul = cities.find((c) => c.name === 'Istanbul');
    assert(istanbul, `Istanbul not found in: ${cities.map((c) => c.name).join(', ')}`);
    assert(istanbul.next_hours.length > 0, 'Istanbul has no next_hours');

    // Ground truth: what hour is it in Istanbul RIGHT NOW, computed
    // independently of anything the server does, using the same wall-clock
    // (Intl + explicit timeZone) technique the fix itself uses.
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const expectedNow = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:00`;

    const firstHour = istanbul.next_hours[0].time;
    assert(
      firstHour === expectedNow,
      `expected next_hours[0].time to be ${expectedNow} (Istanbul's real current hour), got ${firstHour}`
    );
    return `next_hours[0] = ${firstHour}, matches Istanbul's real current hour exactly`;
  });

  await step('empty city list returns [] cleanly (drives the widget\'s "empty" state)', async () => {
    const other = jwt.sign({ id: 'widget-test-user-2', username: 'nobody', role: 'user' }, SECRET, { expiresIn: '1h' });
    const r = await rawGet('/api/weather/overview', `token=${other}`);
    assert(r.status === 200, `status ${r.status}`);
    const cities = JSON.parse(r.body);
    assert(Array.isArray(cities) && cities.length === 0, `expected [], got ${r.body.slice(0, 100)}`);
    return '[]';
  });

  console.log('\n==================================');
  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
