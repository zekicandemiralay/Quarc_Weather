// Tests the new current-location behavior: upsert-not-duplicate, pinned-
// first ordering, and the coordinate-collision edge case.

const jwt = require('jsonwebtoken');

const BASE = 'http://127.0.0.1:3904';
const SECRET = 'testsecret';
const token = jwt.sign({ id: 'loc-test-user', username: 'zeki', role: 'user' }, SECRET, { expiresIn: '1h' });
const authed = { headers: { Cookie: `token=${token}`, 'Content-Type': 'application/json' } };

let pass = 0;
let fail = 0;
function ok(n, extra = '') { console.log(`  [ OK ]  ${n}${extra ? '  — ' + extra : ''}`); pass++; }
function bad(n, d) { console.log(`  [FAIL]  ${n}  — ${d}`); fail++; }
async function check(name, fn) { try { ok(name, await fn()); } catch (e) { bad(name, e.message.split('\n')[0]); } }
function assert(c, m) { if (!c) throw new Error(m); }

(async () => {
  console.log('\nQuarc Weather — current-location behavior\n==========================================\n');

  await check('POST with is_current_location creates one row', async () => {
    const r = await fetch(`${BASE}/api/cities`, {
      ...authed, method: 'POST',
      body: JSON.stringify({ name: '41.010, 28.950', latitude: 41.01, longitude: 28.95, is_current_location: true }),
    });
    const j = await r.json();
    assert(r.status === 201, `status ${r.status}`);
    assert(j.is_current_location === 1, `is_current_location was ${j.is_current_location}`);
    global.firstPinId = j.id;
    return `id ${j.id.slice(0, 8)}…`;
  });

  await check('a second POST from a NEW position moves the SAME row (no duplicate)', async () => {
    const r = await fetch(`${BASE}/api/cities`, {
      ...authed, method: 'POST',
      // ~500km away — definitely not a rounding coincidence
      body: JSON.stringify({ name: '48.850, 2.350', latitude: 48.85, longitude: 2.35, is_current_location: true }),
    });
    const j = await r.json();
    assert(r.status === 200, `expected 200 (update), got ${r.status}`);
    assert(j.id === global.firstPinId, `got a different row: ${j.id}`);
    assert(Math.abs(j.latitude - 48.85) < 0.001, `latitude not updated: ${j.latitude}`);

    const all = await (await fetch(`${BASE}/api/cities`, authed)).json();
    const pins = all.filter((c) => c.is_current_location);
    assert(pins.length === 1, `expected exactly 1 pinned row, found ${pins.length}`);
    return `still 1 row, moved to Paris coords`;
  });

  await check('a regular city is unaffected by pin updates', async () => {
    const r = await fetch(`${BASE}/api/cities`, {
      ...authed, method: 'POST',
      body: JSON.stringify({ name: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503 }),
    });
    const j = await r.json();
    assert(r.status === 201, `status ${r.status}`);
    global.tokyoId = j.id;
    return 'saved';
  });

  await check('GET /api/cities pins My Location first regardless of sort_order', async () => {
    // Move Tokyo to sort_order 0 explicitly, then confirm the pin still leads.
    await fetch(`${BASE}/api/cities/reorder`, {
      ...authed, method: 'PUT', body: JSON.stringify({ ids: [global.tokyoId, global.firstPinId] }),
    });
    const all = await (await fetch(`${BASE}/api/cities`, authed)).json();
    assert(all[0].is_current_location === 1, `first row was ${all[0].name}, not the pin`);
    assert(all[0].id === global.firstPinId, 'pin id mismatch at index 0');
    return `[${all.map((c) => c.is_current_location ? 'PIN' : c.name).join(', ')}]`;
  });

  await check('GET /api/weather/overview also pins My Location first', async () => {
    const all = await (await fetch(`${BASE}/api/weather/overview`, authed)).json();
    assert(all[0].is_current_location === 1, `overview first row was not the pin`);
    return 'confirmed';
  });

  await check('moving the pin onto an existing saved city collapses to that city', async () => {
    // Tokyo is at 35.6762, 139.6503 — move the live pin to the exact same spot.
    const r = await fetch(`${BASE}/api/cities`, {
      ...authed, method: 'POST',
      body: JSON.stringify({ name: '35.676, 139.650', latitude: 35.6762, longitude: 139.6503, is_current_location: true }),
    });
    const j = await r.json();
    assert(j.id === global.tokyoId, `expected the collision to return Tokyo's row, got ${j.id}`);
    assert(j.is_current_location === 0, `Tokyo should not have become the pin: is_current_location=${j.is_current_location}`);

    const all = await (await fetch(`${BASE}/api/cities`, authed)).json();
    const pins = all.filter((c) => c.is_current_location);
    assert(pins.length === 0, `expected the separate pin to be dropped, found ${pins.length} pin(s)`);
    // The pin (previously at Paris) is gone entirely; only Tokyo remains.
    assert(all.length === 1, `expected only Tokyo left, got ${all.length} rows`);
    return `pin dropped, Tokyo's own row returned, ${all.length} city remains`;
  });

  console.log('\n==========================================');
  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
