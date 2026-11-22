// Several simulated devices — each with its own local database (fake-indexeddb), its own clock, and an
// on/off connection — syncing through the REAL server code (backend/src/routes/sync.js on a real SQLite
// database, in this process). It proves the property the whole feature exists for:
//
//     whatever the devices did while out of touch, once they can talk again they all end up identical.
//
// Plus targeted scenarios for the cases people actually hit. The randomised test uses a fixed-seed generator,
// so a failure is reproducible: re-run with the seed it prints.
//
//   node --test tests/sync-sim.test.js        (needs frontend/node_modules and backend/node_modules)

process.env.DB_PATH = ':memory:'; // before the backend modules are loaded

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const BACKEND = path.join(__dirname, '..', 'backend');
require(require.resolve('fake-indexeddb/auto', { paths: [FRONTEND] })); // indexedDB globals, before Dexie loads

const express = require(require.resolve('express', { paths: [BACKEND] }));
const { initDb } = require('../backend/src/db');
const syncRouter = require('../backend/src/routes/sync');

const fe = (rel) => import(pathToFileURL(path.join(FRONTEND, 'src', 'lib', rel)).href);

// --- one real server for the whole file ----------------------------------------------------------
let server;
let port;
let M; // the frontend modules, loaded once

test.before(async () => {
  initDb();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] }; next(); });
  app.use('/api/sync', syncRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  M = {
    localDb: await fe('localDb.js'),
    cities: await fe('cities.js'),
    prefs: await fe('syncedPrefs.js'),
    sync: await fe('sync.js'),
    cityKey: await fe('cityKey.js'),
  };
});
test.after(() => server.close());

// --- virtual time ----------------------------------------------------------------------------------
// Starts SIX hours in the past (the randomised test alone advances ~1 h) so ordinary timestamps never trip the
// server's "not from the future" cap — the fast-clock test below crosses it on purpose.
const HEADROOM_MS = 6 * 3600 * 1000;
const clock = { t: Date.now() - HEADROOM_MS, tick(ms = 1000) { this.t += ms; } };

let dbCounter = 0;
function makeDevice(user, name, { skewMs = 0 } = {}) {
  const db = M.localDb.openDb(`sim-${user}-${name}-${dbCounter++}`);
  const device = { name, user, db, online: true, skewMs, statuses: [] };
  const now = () => new Date(clock.t + device.skewMs);
  device.cities = M.cities.createCityStore(db, { now });
  device.prefs = M.prefs.createSyncedPrefs(db, { now });

  const request = async (p, { method = 'GET', body } = {}) => {
    if (!device.online) throw new M.sync.UnreachableError('no route to the server (Tailscale off)');
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: { 'x-user': user, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  device.sync = M.sync.createSync(db, { request, prefs: device.prefs, setStatus: (s) => device.statuses.push(s) });
  return device;
}

const P = {
  istanbul: { name: 'Istanbul', latitude: 41.0138, longitude: 28.9497, timezone: 'Europe/Istanbul', country: 'Türkiye' },
  berlin: { name: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin', country: 'Germany' },
  sydney: { name: 'Sydney', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney', country: 'Australia' },
  tokyo: { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo', country: 'Japan' },
  cairo: { name: 'Cairo', latitude: 30.0444, longitude: 31.2357, timezone: 'Africa/Cairo', country: 'Egypt' },
  lima: { name: 'Lima', latitude: -12.0464, longitude: -77.0428, timezone: 'America/Lima', country: 'Peru' },
};

const names = async (d) => (await d.cities.listCities()).map((c) => c.name);
const unique = (label) => `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

async function snapshot(d) {
  const list = await d.cities.listCities();
  return JSON.stringify({ cities: list.map((c) => [c.id, c.name, c.timezone]), prefs: await d.prefs.get() });
}

async function settle(devices) {
  for (let round = 0; round < 3; round++) for (const d of devices) await d.sync.syncNow();
}

// --- scenarios -------------------------------------------------------------------------------------------

test('a phone with Tailscale off keeps working; its changes arrive when it reconnects', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');

  phone.online = false; // Tailscale off
  clock.tick(); await phone.cities.addCity(P.istanbul);
  clock.tick(); await phone.cities.addCity(P.berlin);
  await phone.sync.syncNow();
  assert.equal(phone.statuses.at(-1).status, 'unreachable', 'a missing server is "unreachable", not an error');
  assert.equal(phone.statuses.at(-1).pending, 2, 'two changes are waiting');
  assert.deepEqual(await names(phone), ['Istanbul', 'Berlin'], 'the list works fully offline');

  await laptop.sync.syncNow();
  assert.deepEqual(await names(laptop), [], 'the laptop has not heard from the phone yet');

  phone.online = true; // Tailscale back on
  await phone.sync.syncNow();
  assert.equal(phone.statuses.at(-1).status, 'idle');
  assert.equal(phone.statuses.at(-1).pending, 0, 'queue drained');

  await laptop.sync.syncNow();
  assert.deepEqual(await names(laptop), ['Istanbul', 'Berlin']);
});

test('the same city added on two devices while apart is ONE city', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  phone.online = false; laptop.online = false;

  clock.tick(); await phone.cities.addCity(P.istanbul);
  clock.tick(); await laptop.cities.addCity({ ...P.istanbul, name: 'İstanbul' }); // same place, spelt differently
  phone.online = true; laptop.online = true;
  await settle([phone, laptop]);

  assert.equal((await phone.cities.listCities()).length, 1);
  assert.equal(await snapshot(phone), await snapshot(laptop));
});

test('different cities added on two devices are all kept, in one agreed order', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  phone.online = false; laptop.online = false;

  clock.tick(); await phone.cities.addCity(P.istanbul);
  clock.tick(); await laptop.cities.addCity(P.tokyo);
  clock.tick(); await phone.cities.addCity(P.berlin);
  phone.online = true; laptop.online = true;
  await settle([phone, laptop]);

  const a = await names(phone);
  assert.equal(a.length, 3);
  assert.deepEqual(a.slice().sort(), ['Berlin', 'Istanbul', 'Tokyo']);
  assert.deepEqual(await names(laptop), a, 'both devices show the same order');
});

test('one device deletes a city while another reorders a different one: both changes survive', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  for (const p of [P.istanbul, P.berlin, P.sydney]) { clock.tick(); await phone.cities.addCity(p); }
  await settle([phone, laptop]);
  assert.deepEqual(await names(laptop), ['Istanbul', 'Berlin', 'Sydney']);

  phone.online = false; laptop.online = false;
  const ids = (await phone.cities.listCities()).map((c) => c.id);
  clock.tick(); await phone.cities.removeCity(ids[0]); // phone deletes Istanbul
  clock.tick(); await laptop.cities.moveCity(ids[2], -1); // laptop moves Sydney above Berlin
  phone.online = true; laptop.online = true;
  await settle([phone, laptop]);

  assert.deepEqual(await names(phone), ['Sydney', 'Berlin']);
  assert.deepEqual(await names(laptop), ['Sydney', 'Berlin']);
});

test('deleting then re-adding a city works on every device (the re-add wins)', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  clock.tick(); await phone.cities.addCity(P.istanbul);
  await settle([phone, laptop]);

  clock.tick(); await phone.cities.removeCity((await phone.cities.listCities())[0].id);
  await phone.sync.syncNow();
  await laptop.sync.syncNow();
  assert.deepEqual(await names(laptop), [], 'the deletion reached the laptop');

  clock.tick(); await laptop.cities.addCity(P.istanbul);
  await settle([phone, laptop]);
  assert.deepEqual(await names(phone), ['Istanbul']);
  assert.deepEqual(await names(laptop), ['Istanbul']);
});

test('a newer edit beats an older delete from a device that was offline', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  clock.tick(); await phone.cities.addCity(P.istanbul);
  await settle([phone, laptop]);
  const id = (await phone.cities.listCities())[0].id;

  phone.online = false;
  clock.tick(); await phone.cities.removeCity(id); // phone deletes while offline…
  clock.tick(5000); await laptop.cities.moveCity(id, 1); // …no-op move (single city); instead re-add later:
  clock.tick(); await laptop.cities.removeCity(id);
  clock.tick(); await laptop.cities.addCity(P.istanbul); // laptop deleted and re-added LATER than the phone's delete
  phone.online = true;
  await settle([phone, laptop]);

  assert.deepEqual(await names(phone), ['Istanbul'], 'the later re-add wins over the earlier offline delete');
  assert.equal(await snapshot(phone), await snapshot(laptop));
});

test('settings merge per field: units on one device, language on another, both survive', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  phone.online = false; laptop.online = false;

  clock.tick(); await phone.prefs.set({ units: 'imperial', wind_unit: 'mph' });
  clock.tick(); await laptop.prefs.set({ language: 'tr' });
  phone.online = true; laptop.online = true;
  await settle([phone, laptop]);

  for (const d of [phone, laptop]) {
    assert.deepEqual(await d.prefs.get(), { units: 'imperial', wind_unit: 'mph', precip_unit: 'mm', language: 'tr' });
  }
});

test('two edits of the same setting: the newer one wins on every device', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  phone.online = false; laptop.online = false;

  clock.tick(); await phone.prefs.set({ units: 'imperial' });
  clock.tick(10000); await laptop.prefs.set({ units: 'metric' }); // later
  phone.online = true; laptop.online = true;
  await settle([phone, laptop]);

  assert.equal((await phone.prefs.get()).units, 'metric');
  assert.equal((await laptop.prefs.get()).units, 'metric');
});

test('an unsent edit survives a pull that brings an OLDER version of the same city', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  const laptop = makeDevice(user, 'laptop');
  clock.tick(); await phone.cities.addCity(P.istanbul);
  clock.tick(); await phone.cities.addCity(P.berlin);
  await settle([phone, laptop]);

  const ids = (await phone.cities.listCities()).map((c) => c.id);
  clock.tick(); await laptop.cities.moveCity(ids[1], -1); // laptop: Berlin first (synced)
  await laptop.sync.syncNow();

  phone.online = false;
  clock.tick(10000); await phone.cities.moveCity(ids[0], 1); // phone, LATER, offline: Istanbul down → Berlin first as well
  phone.online = true;
  await phone.sync.syncNow(); // the pull inside this must not wipe the unsent newer edit
  await settle([phone, laptop]);
  assert.equal(await snapshot(phone), await snapshot(laptop));
  assert.equal((await phone.db.outbox.count()), 0);
});

test('a device whose clock runs 10 minutes FAST converges, and does not re-queue its changes forever', async () => {
  const user = unique('u');
  // Virtual time sits ~6 h in the past, so +6 h 10 min puts this device 10 minutes into the real future:
  // beyond the server's 5-minute cap, which will clip its timestamps.
  const fast = makeDevice(user, 'fast-phone', { skewMs: HEADROOM_MS + 10 * 60 * 1000 });
  const normal = makeDevice(user, 'laptop');

  clock.tick(); await fast.cities.addCity(P.istanbul);
  clock.tick(); await fast.prefs.set({ units: 'imperial', language: 'tr' });
  await fast.sync.syncNow();
  await fast.sync.syncNow();
  assert.equal(await fast.db.outbox.count(), 0, 'after syncing, nothing may be left queued (it used to retry forever)');
  assert.equal(fast.statuses.at(-1).pending, 0);

  await normal.sync.syncNow();
  assert.deepEqual(await names(normal), ['Istanbul']);
  assert.deepEqual(await normal.prefs.get(), { units: 'imperial', wind_unit: 'kmh', precip_unit: 'mm', language: 'tr' });

  // The fast clock's cities still lose a LATER honest edit only for as long as the cap window lasts;
  // what matters here is that both devices agree and nothing is stuck.
  await settle([fast, normal]);
  assert.equal(await snapshot(fast), await snapshot(normal));
  assert.equal(await fast.db.outbox.count(), 0);
  assert.equal(await normal.db.outbox.count(), 0);
});

test('accounts never see each other, even for the identical city', async () => {
  const a1 = makeDevice(unique('alice'), 'a1');
  const b1 = makeDevice(unique('bob'), 'b1');
  clock.tick(); await a1.cities.addCity(P.istanbul);
  clock.tick(); await b1.cities.addCity({ ...P.istanbul, name: 'Bob Istanbul' });
  await settle([a1, b1]);
  assert.deepEqual(await names(a1), ['Istanbul']);
  assert.deepEqual(await names(b1), ['Bob Istanbul']);
});

test('logging in as a DIFFERENT user wipes the previous user\'s local data', async () => {
  const alice = unique('alice');
  const d = makeDevice(alice, 'shared-tablet');
  await d.sync.adoptUser(alice);
  clock.tick(); await d.cities.addCity(P.istanbul);
  assert.deepEqual(await names(d), ['Istanbul']);

  await d.sync.adoptUser(unique('bob')); // someone else signs in on this device
  assert.deepEqual(await names(d), [], "Alice's cities must not leak to Bob");
  assert.equal(await d.db.outbox.count(), 0, "…nor Alice's unsent changes");

  const e = makeDevice(alice, 'tablet2');
  await e.sync.adoptUser(alice);
  clock.tick(); await e.cities.addCity(P.berlin);
  await e.sync.adoptUser(alice); // the SAME user again: nothing is wiped
  assert.deepEqual(await names(e), ['Berlin']);
});

test('a brand-new device downloads the whole account on its first sync', async () => {
  const user = unique('u');
  const phone = makeDevice(user, 'phone');
  for (const p of [P.istanbul, P.berlin, P.sydney]) { clock.tick(); await phone.cities.addCity(p); }
  await phone.prefs.set({ language: 'tr' });
  await settle([phone]);

  const tablet = makeDevice(user, 'tablet');
  await tablet.sync.syncNow();
  assert.deepEqual(await names(tablet), ['Istanbul', 'Berlin', 'Sydney']);
  assert.equal((await tablet.prefs.get()).language, 'tr');
});

// --- the property test ---------------------------------------------------------------------------------------

function rng(seed) { // mulberry32: small, fast, deterministic
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('RANDOMISED: 3 devices, random offline spells, wrong clocks, random edits — always converge', async () => {
  const SEEDS = 25;
  const OPS = 70;
  const places = Object.values(P);
  const prefChoices = [{ units: 'imperial' }, { units: 'metric' }, { wind_unit: 'mph' }, { wind_unit: 'kn' }, { precip_unit: 'inch' }, { language: 'tr' }, { language: 'en' }];

  for (let seed = 1; seed <= SEEDS; seed++) {
    const rand = rng(seed);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const user = unique(`rand${seed}`);
    // Clocks wrong by up to ±3 minutes, like phones that have not synced their time in a while.
    const devices = ['phone', 'laptop', 'tablet'].map((n) => makeDevice(user, n, { skewMs: Math.round((rand() - 0.5) * 6 * 60 * 1000) }));
    const log = [];

    for (let i = 0; i < OPS; i++) {
      const d = pick(devices);
      clock.tick(Math.round(200 + rand() * 4000));
      const roll = rand();
      try {
        if (roll < 0.28) {
          const place = pick(places);
          log.push(`${d.name} add ${place.name}`);
          await d.cities.addCity(place);
        } else if (roll < 0.40) {
          const live = await d.cities.listCities();
          if (live.length) { const c = pick(live); log.push(`${d.name} remove ${c.name}`); await d.cities.removeCity(c.id); }
        } else if (roll < 0.55) {
          const live = await d.cities.listCities();
          if (live.length > 1) { const c = pick(live); const dir = rand() < 0.5 ? -1 : 1; log.push(`${d.name} move ${c.name} ${dir}`); await d.cities.moveCity(c.id, dir); }
        } else if (roll < 0.65) {
          const patch = pick(prefChoices);
          log.push(`${d.name} prefs ${JSON.stringify(patch)}`);
          await d.prefs.set(patch);
        } else if (roll < 0.85) {
          log.push(`${d.name} sync (${d.online ? 'online' : 'offline'})`);
          await d.sync.syncNow();
        } else {
          d.online = !d.online;
          log.push(`${d.name} -> ${d.online ? 'online' : 'OFFLINE'}`);
        }
      } catch (e) {
        assert.fail(`seed ${seed}: operation threw — ${e.stack}\nlog:\n${log.join('\n')}`);
      }
    }

    for (const d of devices) d.online = true;
    await settle(devices);

    // …and a device that joins now sees exactly what the others see (the server holds the same truth).
    const late = makeDevice(user, 'late');
    await late.sync.syncNow();

    const snaps = [];
    for (const d of [...devices, late]) snaps.push(await snapshot(d));
    for (let i = 1; i < snaps.length; i++) {
      assert.equal(snaps[i], snaps[0], `seed ${seed}: devices diverged\n  ${devices[0].name}: ${snaps[0]}\n  ${[...devices, late][i].name}: ${snaps[i]}\nlog:\n${log.join('\n')}`);
    }
    for (const d of devices) assert.equal(await d.db.outbox.count(), 0, `seed ${seed}: ${d.name} still has unsent changes`);

    // Invariants of the shared state.
    const final = await devices[0].cities.listCities();
    assert.equal(new Set(final.map((c) => c.id)).size, final.length, `seed ${seed}: duplicate city ids`);
    for (const c of final) assert.equal(c.id, M.cityKey.cityKey(c.latitude, c.longitude), `seed ${seed}: id/coordinates mismatch`);
  }
});
