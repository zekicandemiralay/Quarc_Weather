// End-to-end exercise of the sync API (/api/sync/pull + /push) against a locally running backend,
// with several "devices" taking turns. Mints its own JWTs with the same secret the server was
// started with, standing in for what quarc-auth would issue in production.
//
//   JWT_SECRET=testsecret PORT=3904 DB_PATH=<scratch> node backend/src/index.js
//   JWT_SECRET=testsecret NODE_PATH=backend/node_modules node tests/sync-api.test.js
//
// Destructive to the test users' data: point DB_PATH at a scratch database.

const jwt = require('jsonwebtoken');

const BASE = 'http://127.0.0.1:3904';
const SECRET = process.env.JWT_SECRET || 'testsecret';
const RUN = Date.now().toString(36); // every run uses fresh accounts, so reruns never collide

const tokenFor = (id) => jwt.sign({ id, username: id, role: 'user' }, SECRET, { expiresIn: '1h' });
const as = (user) => ({ headers: { Cookie: `token=${tokenFor(user)}`, 'Content-Type': 'application/json' } });

let pass = 0;
let fail = 0;
const ok = (name, extra = '') => { console.log(`  [ OK ]  ${name}${extra ? '  — ' + extra : ''}`); pass++; };
const bad = (name, detail) => { console.log(`  [FAIL]  ${name}  — ${detail}`); fail++; };
async function check(name, fn) {
  try { ok(name, await fn()); } catch (e) { bad(name, e.message.split('\n')[0]); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- tiny client -------------------------------------------------------------
const key = (lat, lon) => `c_${Math.round(lat * 100)}_${Math.round(lon * 100)}`;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

async function pull(user, since = '') {
  const r = await fetch(`${BASE}/api/sync/pull?since=${encodeURIComponent(since)}`, as(user));
  assert(r.status === 200, `pull status ${r.status}`);
  return r.json();
}
async function push(user, mutations) {
  const r = await fetch(`${BASE}/api/sync/push`, { ...as(user), method: 'POST', body: JSON.stringify({ mutations }) });
  assert(r.status === 200, `push status ${r.status}`);
  return (await r.json()).results;
}
const city = (name, lat, lon, extra = {}) => ({
  name, latitude: lat, longitude: lon, country: 'X', country_code: 'XX', admin1: 'Y', timezone: 'Europe/Istanbul', sort_order: 0, ...extra,
});
const up = (c, t = iso(), data = {}) => ({
  table: 'cities', id: key(c.latitude, c.longitude), op: 'upsert', client_updated_at: t, data: { ...c, ...data },
});
const del = (c, t = iso()) => ({ table: 'cities', id: key(c.latitude, c.longitude), op: 'delete', client_updated_at: t });
const live = (p) => p.cities.filter((c) => !c.is_deleted);

(async () => {
  console.log('\nQuarc Weather — sync API test\n=============================\n');

  const ISTANBUL = city('Istanbul', 41.0138, 28.9497);
  const BERLIN = city('Berlin', 52.52, 13.405);
  const SYDNEY = city('Sydney', -33.8688, 151.2093, { timezone: 'Australia/Sydney' });

  console.log('Auth gate');
  for (const [m, p] of [['GET', '/api/sync/pull'], ['POST', '/api/sync/push']]) {
    await check(`${m} ${p} rejects anonymous`, async () => {
      const r = await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{}' : undefined });
      assert(r.status === 401, `expected 401, got ${r.status}`);
      return '401';
    });
  }
  await check('a token signed with the wrong secret is rejected', async () => {
    const wrong = jwt.sign({ id: 'x', username: 'x', role: 'user' }, 'not-the-secret');
    const r = await fetch(`${BASE}/api/sync/pull`, { headers: { Cookie: `token=${wrong}` } });
    assert(r.status === 401, `expected 401, got ${r.status}`);
    return '401';
  });
  await check('the old per-server endpoints are gone (cities/prefs/weather/geocode now live on the device)', async () => {
    for (const p of ['/api/cities', '/api/prefs', '/api/weather?lat=41&lon=29', '/api/geocode/search?q=berlin']) {
      const r = await fetch(`${BASE}${p}`, as(`gone-${RUN}`));
      assert(r.status === 404, `${p} answered ${r.status}, expected 404`);
    }
    return '404 ×4';
  });

  console.log('\nBasics');
  const A = `alice-${RUN}`;
  await check('a new account pulls an empty state', async () => {
    const p = await pull(A);
    assert(p.cities.length === 0 && p.prefs === null && p.hasMore === false, JSON.stringify(p));
    return 'empty';
  });
  await check('adding a city: accepted, then visible to a pull with its derived id', async () => {
    const [r] = await push(A, [up(ISTANBUL)]);
    assert(r.status === 'ok', JSON.stringify(r));
    const p = await pull(A);
    assert(live(p).length === 1, `expected 1 city, got ${live(p).length}`);
    const c = p.cities[0];
    assert(c.id === 'c_4101_2895' && c.name === 'Istanbul' && c.timezone === 'Europe/Istanbul', JSON.stringify(c));
    assert(c.updated_at && c.client_updated_at && !('user_id' in c), 'row shape');
    return c.id;
  });
  await check('retrying the identical push (a lost response) is harmless', async () => {
    const m = up(ISTANBUL, iso());
    await push(A, [m]);
    const [r] = await push(A, [m]);
    assert(r.status === 'ok', JSON.stringify(r));
    assert(live(await pull(A)).length === 1, 'duplicate row created');
    return 'idempotent';
  });
  await check('invalid mutations are refused individually, without blocking valid ones in the same push', async () => {
    const results = await push(A, [
      { ...up(BERLIN), id: 'c_9999_9999' }, // id is not the key of its coordinates
      up(city('', 10, 10)), // no name
      up(city('Nowhere', 95, 10)), // latitude out of range
      { ...up(BERLIN), op: 'explode' }, // unknown op
      { ...up(BERLIN), client_updated_at: 'yesterday-ish' }, // not a timestamp
      { table: 'events', id: 'x', op: 'upsert', client_updated_at: iso() }, // unknown table
      up(BERLIN), // …and one good one
    ]);
    const statuses = results.map((r) => r.status);
    assert(statuses.slice(0, 6).every((s) => s === 'invalid'), `statuses: ${statuses}`);
    assert(statuses[6] === 'ok', `the valid mutation was blocked: ${statuses}`);
    return statuses.join(',');
  });

  console.log('\nTwo devices, one account');
  const B = `bea-${RUN}`;
  await check('the SAME place added on two devices is ONE city (ids come from the coordinates)', async () => {
    await push(B, [up(ISTANBUL, iso(-2000))]); // "phone" adds Istanbul
    await push(B, [up(ISTANBUL, iso(-1000), { name: 'İstanbul' })]); // "laptop" adds it independently, a moment later
    const p = await pull(B);
    assert(live(p).length === 1, `expected 1, got ${live(p).length}`);
    assert(p.cities[0].name === 'İstanbul', 'the later edit should win');
    return '1 row, later name won';
  });
  await check('a stale edit (older than what the server holds) is answered "stale" with the server row', async () => {
    const [r] = await push(B, [up(ISTANBUL, iso(-60000), { name: 'OLD NAME' })]);
    assert(r.status === 'stale' && r.row && r.row.name === 'İstanbul', JSON.stringify(r));
    assert((await pull(B)).cities[0].name === 'İstanbul', 'stale edit must not apply');
    return 'stale + row returned';
  });
  await check('deleting leaves a tombstone, so other devices learn of it', async () => {
    const before = await pull(B);
    const [r] = await push(B, [del(ISTANBUL, iso())]);
    assert(r.status === 'ok', JSON.stringify(r));
    const delta = await pull(B, before.cursor);
    assert(delta.cities.length === 1 && delta.cities[0].is_deleted === 1, `delta: ${JSON.stringify(delta.cities)}`);
    assert(live(await pull(B)).length === 0, 'still live');
    return 'tombstone in the delta';
  });
  await check('a delete older than a newer edit loses (stale)', async () => {
    await push(B, [up(BERLIN, iso())]);
    const [r] = await push(B, [del(BERLIN, iso(-60000))]);
    assert(r.status === 'stale', JSON.stringify(r));
    assert(live(await pull(B)).some((c) => c.name === 'Berlin'), 'Berlin must survive');
    return 'edit beat the older delete';
  });
  await check('re-adding a deleted city (newer edit) brings it back', async () => {
    const [r] = await push(B, [up(ISTANBUL, iso())]);
    assert(r.status === 'ok', JSON.stringify(r));
    const p = await pull(B);
    const c = p.cities.find((x) => x.id === 'c_4101_2895');
    assert(c && c.is_deleted === 0, JSON.stringify(c));
    return 'resurrected';
  });
  await check('two devices reorder DIFFERENT cities concurrently: both orders survive', async () => {
    const C = `cleo-${RUN}`;
    await push(C, [up(ISTANBUL, iso(-5000), { sort_order: 0 }), up(BERLIN, iso(-5000), { sort_order: 1 }), up(SYDNEY, iso(-5000), { sort_order: 2 })]);
    await push(C, [up(SYDNEY, iso(-2000), { sort_order: -0.5 })]); // device 1 moves Sydney to the top
    await push(C, [up(BERLIN, iso(-1000), { sort_order: 2.5 })]); // device 2 moves Berlin to the bottom
    const order = live(await pull(C)).sort((a, b) => a.sort_order - b.sort_order).map((c) => c.name);
    assert(order.join() === 'Sydney,Istanbul,Berlin', `order: ${order}`);
    return order.join(' → ');
  });
  await check('fractional sort orders are stored exactly', async () => {
    const D = `dan-${RUN}`;
    await push(D, [up(ISTANBUL, iso(), { sort_order: 1.0000001 })]);
    assert((await pull(D)).cities[0].sort_order === 1.0000001, 'precision lost');
    return '1.0000001';
  });

  console.log('\nClock safety');
  await check('an edit stamped far in the future is capped, so it cannot win every later conflict', async () => {
    const E = `eve-${RUN}`;
    const nextYear = iso(365 * 24 * 3600 * 1000);
    await push(E, [up(ISTANBUL, nextYear, { name: 'From the future' })]);
    const stored = Date.parse((await pull(E)).cities[0].client_updated_at);
    assert(stored <= Date.now() + 5 * 60 * 1000 + 1000, `stored ${new Date(stored).toISOString()}`);
    // …and an honest edit made 10 minutes later now wins.
    const [r] = await push(E, [up(ISTANBUL, iso(10 * 60 * 1000), { name: 'Honest edit' })]);
    assert(r.status === 'ok', JSON.stringify(r));
    assert((await pull(E)).cities[0].name === 'Honest edit', 'honest edit did not win');
    return 'capped at now + 5 min';
  });

  console.log('\nPulling');
  await check('pull with the returned cursor returns only what changed since', async () => {
    const F = `fay-${RUN}`;
    await push(F, [up(ISTANBUL), up(BERLIN)]);
    const first = await pull(F);
    assert(first.cities.length === 2, 'first pull');
    const none = await pull(F, first.cursor);
    assert(none.cities.length === 0 && none.cursor === first.cursor, `expected nothing, got ${JSON.stringify(none)}`);
    await push(F, [up(SYDNEY)]);
    const delta = await pull(F, first.cursor);
    assert(delta.cities.length === 1 && delta.cities[0].name === 'Sydney', JSON.stringify(delta.cities));
    return '2 → 0 → 1';
  });
  await check('1,200 cities page correctly: no row skipped or repeated', async () => {
    const G = `gus-${RUN}`;
    const all = [];
    for (let i = 0; i < 1200; i++) all.push(up(city(`Town ${i}`, (i % 90) - 45 + Math.floor(i / 90) * 0.01, 10 + Math.floor(i / 90) * 0.03)));
    for (let i = 0; i < all.length; i += 400) await push(G, all.slice(i, i + 400));
    const seen = new Set();
    let since = '';
    let pages = 0;
    for (;;) {
      const p = await pull(G, since);
      pages++;
      for (const c of p.cities) {
        assert(!seen.has(c.id), `row repeated: ${c.id}`);
        seen.add(c.id);
      }
      since = p.cursor;
      if (!p.hasMore) break;
      assert(pages < 10, 'paging did not terminate');
    }
    assert(seen.size === 1200, `saw ${seen.size} of 1200 rows`);
    assert(pages === 2, `expected 2 pages, got ${pages}`);
    return `1200 rows in ${pages} pages`;
  });

  console.log('\nSettings (merged field by field)');
  const H = `hal-${RUN}`;
  await check('no settings yet → pull has prefs: null', async () => {
    assert((await pull(H)).prefs === null, 'prefs should be null');
    return 'null';
  });
  await check('two devices change DIFFERENT settings: both changes survive', async () => {
    const t1 = iso(-3000);
    const t2 = iso(-1000);
    const [r1] = await push(H, [{ table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: t1, data: { fields: { units: { value: 'imperial', t: t1 } } } }]);
    assert(r1.status === 'ok' && r1.row.fields.units.value === 'imperial', JSON.stringify(r1));
    const [r2] = await push(H, [{ table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: t2, data: { fields: { language: { value: 'tr', t: t2 } } } }]);
    const f = r2.row.fields;
    assert(f.units.value === 'imperial' && f.language.value === 'tr', JSON.stringify(f));
    const p = await pull(H);
    assert(p.prefs.fields.units.value === 'imperial' && p.prefs.fields.language.value === 'tr', 'pull disagrees');
    return 'units=imperial, language=tr';
  });
  await check('an older value for a field does not overwrite a newer one; the merged row comes back', async () => {
    const [r] = await push(H, [{ table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: iso(), data: { fields: { units: { value: 'metric', t: iso(-3600 * 1000) } } } }]);
    assert(r.row.fields.units.value === 'imperial', JSON.stringify(r.row.fields.units));
    return 'still imperial';
  });
  await check('a newer value for a field wins', async () => {
    const [r] = await push(H, [{ table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: iso(), data: { fields: { units: { value: 'metric', t: iso() } } } }]);
    assert(r.row.fields.units.value === 'metric', JSON.stringify(r.row.fields.units));
    return 'metric';
  });
  await check('invalid values and unknown fields (theme, briefing) are ignored, never stored', async () => {
    const t = iso();
    const [r] = await push(H, [{
      table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: t,
      data: { fields: { wind_unit: { value: 'warp', t }, theme: { value: 'dark', t }, daily_briefing_enabled: { value: 1, t } } },
    }]);
    assert(r.row.fields.wind_unit.value === 'kmh', `wind_unit became ${r.row.fields.wind_unit.value}`);
    assert(!('theme' in r.row.fields) && !('daily_briefing_enabled' in r.row.fields), 'per-device settings must not sync');
    return 'ignored';
  });
  await check('the cursor passes settings changes too: a device that pulled before sees them after', async () => {
    const before = await pull(H);
    await push(H, [{ table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: iso(), data: { fields: { precip_unit: { value: 'inch', t: iso() } } } }]);
    const delta = await pull(H, before.cursor);
    assert(delta.prefs && delta.prefs.fields.precip_unit.value === 'inch', JSON.stringify(delta.prefs));
    const none = await pull(H, delta.cursor);
    assert(none.prefs === null, 'prefs repeated after the cursor passed them');
    return 'delta, then nothing';
  });

  console.log('\nIsolation');
  await check("one account never sees another's cities or settings, even for the very same place", async () => {
    const X = `xena-${RUN}`;
    const Y = `yuri-${RUN}`;
    await push(X, [up(ISTANBUL, iso(), { name: 'Xena Istanbul' })]);
    await push(Y, [up(ISTANBUL, iso(-10000), { name: 'Yuri Istanbul' })]);
    assert((await pull(X)).cities[0].name === 'Xena Istanbul', 'X polluted');
    assert((await pull(Y)).cities[0].name === 'Yuri Istanbul', 'Y polluted');
    assert((await pull(`nobody-${RUN}`)).cities.length === 0, 'a third account saw rows');
    // Y deleting must not touch X's identical city id.
    await push(Y, [del(ISTANBUL, iso())]);
    assert(live(await pull(X)).length === 1, "X's city was deleted by Y");
    return 'isolated';
  });

  console.log('\n=============================');
  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
