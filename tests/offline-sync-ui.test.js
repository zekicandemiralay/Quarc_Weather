// The offline-first app, end to end in real browsers against the real stack (quarc-auth + backend + Open-Meteo):
//
//   "Tailscale off"  = every request to the Quarc server (/api/*) is blocked while the internet — and with it the
//                      weather provider — stays reachable. That is exactly the situation this feature is for.
//   Two devices      = two separate browser contexts (separate storage) logged in as the same account.
//
// Proves: the app opens and works with the server unreachable; the weather comes straight from the provider;
// changes made offline sync when the server returns; two devices merge; My Location stays on each device.
//
//   (stack running as for ui.test.js: quarc-auth :3902, backend :3904, built frontend preview :4173)
//   node tests/offline-sync-ui.test.js

const puppeteer = require('puppeteer');
const jwt = require('jsonwebtoken');
const path = require('path');
const H = require('./helpers/app');

const BASE = 'http://127.0.0.1:4173';
const BACKEND = 'http://127.0.0.1:3904';
const SECRET = process.env.JWT_SECRET || 'testsecret';
const SHOTS = path.join(__dirname, 'shots-offline-sync');
const USER = 'zeki';
const PASS = 'testpass123';

let pass = 0;
let fail = 0;
const ok = (n, extra = '') => { console.log(`  [ OK ]  ${n}${extra ? '  — ' + extra : ''}`); pass++; };
const bad = (n, d) => { console.log(`  [FAIL]  ${n}  — ${d}`); fail++; };
async function step(name, fn) { try { ok(name, await fn()); } catch (e) { bad(name, e.message.split('\n')[0]); } }
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the server's view of the account (to check what really reached it) -------------------------------------
let userId;
const asUser = () => ({ headers: { Cookie: `token=${jwt.sign({ id: userId, username: USER, role: 'admin' }, SECRET)}`, 'Content-Type': 'application/json' } });
async function serverState() {
  const j = await (await fetch(`${BACKEND}/api/sync/pull?since=`, asUser())).json();
  const live = j.cities.filter((c) => !c.is_deleted).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  return { cities: live.map((c) => c.name), all: j.cities, prefs: j.prefs };
}
async function resetAccount() {
  const j = await (await fetch(`${BACKEND}/api/sync/pull?since=`, asUser())).json();
  // Stamped NOW, not in the future: a reset must not out-rank the edits the test makes right after it.
  const future = new Date().toISOString();
  const mutations = j.cities.filter((c) => !c.is_deleted).map((c) => ({ table: 'cities', id: c.id, op: 'delete', client_updated_at: future }));
  if (mutations.length) await fetch(`${BACKEND}/api/sync/push`, { ...asUser(), method: 'POST', body: JSON.stringify({ mutations }) });
  const fields = {};
  for (const [k, v] of [['units', 'metric'], ['wind_unit', 'kmh'], ['precip_unit', 'mm'], ['language', 'en']]) fields[k] = { value: v, t: future };
  await sleep(50);
  await fetch(`${BACKEND}/api/sync/push`, { ...asUser(), method: 'POST', body: JSON.stringify({ mutations: [{ table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: future, data: { fields } }] }) });
}
/** Polls what the SERVER holds until it satisfies the check (sync is asynchronous). */
async function waitServer(check, what, timeout = 25000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await serverState();
    if (check(last)) return last;
    await sleep(500);
  }
  throw new Error(`server never reached "${what}" (has: ${last.cities.join(',')})`);
}

// --- a "device" ----------------------------------------------------------------------------------------------
async function newDevice(browser, name, geo) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 1 });
  const device = { name, context, page, blocked: false, errors: [], pageErrors: [], hits: { provider: 0, quarcWeather: 0 } };

  if (geo) {
    await context.overridePermissions(BASE, ['geolocation']);
    await page.setGeolocation(geo);
  } else {
    await context.overridePermissions(BASE, []); // denied: lands on the list, no My Location
  }

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname === 'api.open-meteo.com') device.hits.provider++;
    if (u.origin === BASE && /\/api\/(weather|geocode)/.test(u.pathname)) device.hits.quarcWeather++;
    // "Tailscale off": the Quarc server cannot be reached at all. (Weather and search go to other hosts.)
    if (device.blocked && u.origin === BASE && u.pathname.startsWith('/api/')) return req.abort('connectionrefused');
    // City search: the real geocoder answer, fetched once per query per run (see helpers/app.js).
    if (u.hostname === H.GEOCODER_HOST) return H.replayGeocode(req);
    return req.continue();
  });
  page.on('pageerror', (e) => device.pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|status of 401/.test(m.text())) device.errors.push(m.text()); });
  return device;
}

async function login(d) {
  await d.page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await d.page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
  await d.page.type('input[placeholder="Username"]', USER);
  await d.page.type('input[placeholder="Password"]', PASS);
  await Promise.all([
    d.page.click('button[type="submit"]'),
    d.page.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
  ]);
}

const text = (d) => d.page.evaluate(() => document.body.innerText);
const cardNames = (d) => d.page.$$eval('ul > li', (lis) => lis.map((li) => li.querySelector('p span.truncate')?.textContent?.trim() || '').filter(Boolean));
/** Waits until the list shows (all of `has`) and (none of `hasNot`). */
const waitCards = (d, { has = [], hasNot = [] }, timeout = 20000) =>
  d.page.waitForFunction(
    (wanted, unwanted) => {
      const names = Array.from(document.querySelectorAll('ul > li')).map((li) => li.querySelector('p span.truncate')?.textContent?.trim() || '').filter(Boolean);
      return wanted.every((w) => names.some((n) => n.includes(w))) && unwanted.every((u) => !names.some((n) => n.includes(u)));
    },
    { timeout },
    has,
    hasNot
  );

/**
 * Opens the app and ends on the city LIST. A device with a GPS fix opens on My Location (the real app does too), so
 * — like a person — press the in-app back button to reach the list.
 */
async function goList(d) {
  await d.page.goto(BASE, { waitUntil: 'networkidle2' });
  await d.page.waitForSelector('button[aria-label="Add city"], .sky h1, p', { timeout: 20000 });
  await sleep(800);
  if (await d.page.$('.sky h1')) {
    await d.page.evaluate(() => Array.from(document.querySelectorAll('header button')).find((b) => b.innerText.includes('‹'))?.click());
  }
  await d.page.waitForSelector('button[aria-label="Add city"]', { timeout: 15000 });
}

/** From the list: tap +, search, pick the first hit — all inside the app, no page reload. */
async function addCityByName(d, query, expectName) {
  await d.page.click('button[aria-label="Add city"]');
  await d.page.waitForSelector('input', { timeout: 10000 });
  await d.page.type('input', query);
  await d.page.waitForFunction(() => document.querySelectorAll('li button').length > 0, { timeout: 20000 });
  const first = await d.page.$eval('li button p', (p) => p.textContent.trim());
  assert(!expectName || first.includes(expectName), `first search hit was "${first}"`);
  await d.page.click('li button');
  await d.page.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
}

const cardButton = (d, name, selector) =>
  d.page.evaluate(
    (n, sel) => {
      const li = Array.from(document.querySelectorAll('ul > li')).find((x) => x.textContent.includes(n));
      li.querySelector(sel).click();
    },
    name,
    selector
  );

/** Tells the app the network is back (what a browser fires when connectivity returns). */
const reconnect = (d) => d.page.evaluate(() => window.dispatchEvent(new Event('online')));
const noBadge = (d, timeout = 25000) => d.page.waitForFunction(() => !document.querySelector('[data-testid="sync-badge"]'), { timeout });
const badge = (d) => d.page.$eval('[data-testid="sync-badge"]', (e) => ({ text: e.textContent.trim(), status: e.dataset.status })).catch(() => null);

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  console.log('\nQuarc Weather — offline-first app (real browsers, real stack)\n=============================================================\n');

  const phone = await newDevice(browser, 'phone', { latitude: 41.0082, longitude: 28.9784 }); // Istanbul
  const laptop = await newDevice(browser, 'laptop', { latitude: 52.52, longitude: 13.405 }); // Berlin

  await step('sign in on the phone (needs the server once) and start from a clean account', async () => {
    await login(phone);
    userId = await phone.page.evaluate(async () => (await (await fetch('/api/auth/me', { credentials: 'include' })).json()).id);
    assert(userId, 'no user id');
    await resetAccount();
    return `user ${userId.slice(0, 8)}…`;
  });

  console.log('Weather comes from the device, not the server');
  await step('the phone opened on My Location with a real forecast fetched straight from the weather provider', async () => {
    // The phone has a live GPS fix, so after signing in the app lands on My Location.
    await phone.page.waitForFunction(() => location.pathname === '/city/here', { timeout: 20000 });
    await phone.page.waitForFunction(() => /\d+°/.test(document.body.innerText) && /Hourly forecast/i.test(document.body.textContent), { timeout: 20000 });
    assert(phone.hits.provider >= 1, 'the forecast did not come from the provider');
    assert(phone.hits.quarcWeather === 0, `the Quarc server was asked for weather ${phone.hits.quarcWeather}×`);
    const t = await text(phone);
    assert(/Cankurtaran|Fatih|Istanbul|İstanbul/i.test(t), `My Location name not resolved: ${t.slice(0, 80)}`);
    await phone.page.screenshot({ path: path.join(SHOTS, '1-my-location.png') });
    return `provider ×${phone.hits.provider}, Quarc server weather ×0`;
  });

  console.log('\nTailscale OFF');
  await step('add a city while the server is unreachable: it saves locally and the badge says so', async () => {
    await goList(phone);
    phone.blocked = true;
    await addCityByName(phone, 'Berlin', 'Berlin');
    await waitCards(phone, { has: ['Berlin'] });
    await phone.page.waitForSelector('[data-testid="sync-badge"]', { timeout: 15000 });
    await sleep(1500); // let the (blocked) sync attempt run
    const b = await badge(phone);
    assert(b && b.status === 'unreachable', `badge: ${JSON.stringify(b)}`);
    assert(/1 change/.test(b.text), `badge text: ${b.text}`);
    const server = await serverState();
    assert(!server.cities.includes('Berlin'), 'Berlin reached the server although it was blocked');
    await phone.page.screenshot({ path: path.join(SHOTS, '2-offline-added.png') });
    return b.text;
  });

  await step('the app COLD-STARTS with the server unreachable and shows the saved list with live forecasts', async () => {
    await goList(phone); // full page load, server still blocked
    await waitCards(phone, { has: ['Berlin'] });
    // …and the card gets its forecast without any server.
    await phone.page.waitForFunction(
      () => Array.from(document.querySelectorAll('ul > li')).some((li) => li.textContent.includes('Berlin') && /\d/.test(li.querySelector('.text-5xl')?.textContent || '')),
      { timeout: 20000 }
    );
    const onLogin = await phone.page.evaluate(() => !!document.querySelector('input[placeholder="Username"]'));
    assert(!onLogin, 'the app bounced to the login screen');
    return 'list + live forecast, no server';
  });

  await step('a city can still be opened and its full forecast read with the server unreachable', async () => {
    await cardButton(phone, 'Berlin', 'button');
    await phone.page.waitForFunction(() => location.pathname.startsWith('/city/c_'), { timeout: 10000 });
    await phone.page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent) && /10-day forecast/i.test(document.body.textContent), { timeout: 20000 });
    await phone.page.screenshot({ path: path.join(SHOTS, '3-offline-city.png') });
    return 'hourly + 10-day rendered';
  });

  console.log('\nBack online');
  await step('when the server returns, the offline change reaches it and the badge clears', async () => {
    await goList(phone);
    phone.blocked = false;
    await reconnect(phone);
    await waitServer((s) => s.cities.includes('Berlin'), 'Berlin');
    await noBadge(phone);
    return 'Berlin is on the server';
  });

  await step('My Location never reaches the server (it belongs to the device)', async () => {
    const server = await serverState();
    assert(server.cities.join() === 'Berlin', `expected only Berlin, got ${server.cities.join(',')}`);
    assert(!server.all.some((c) => /Cankurtaran|Fatih|Istanbul/i.test(c.name) && !c.is_deleted), 'My Location is on the server');
    return 'only manual cities are on the server';
  });

  console.log('\nA second device');
  await step('a new device signs in and downloads the list; its My Location is its own (Berlin vs Istanbul)', async () => {
    await login(laptop);
    await goList(laptop);
    await waitCards(laptop, { has: ['Berlin'] });
    await goList(phone);
    const phoneNames = await cardNames(phone);
    const laptopNames = await cardNames(laptop);
    assert(/Cankurtaran|Fatih|Istanbul|İstanbul|Sultanahmet/i.test(phoneNames[0]), `phone's first card: ${phoneNames[0]}`);
    assert(/Mitte|Berlin|Tiergarten/i.test(laptopNames[0]) && laptopNames[0] !== 'Berlin', `laptop's first card: ${laptopNames[0]}`);
    assert(phoneNames[0] !== laptopNames[0], 'both devices show the same My Location');
    await laptop.page.screenshot({ path: path.join(SHOTS, '4-laptop-list.png') });
    return `phone: ${phoneNames.join(' | ')}   laptop: ${laptopNames.join(' | ')}`;
  });

  await step('cities added on the laptop reach the server and then the phone', async () => {
    await addCityByName(laptop, 'Sydney', 'Sydney');
    await addCityByName(laptop, 'Tokyo', 'Tokyo').catch(async () => {
      await goList(laptop);
      await addCityByName(laptop, 'Tokyo', 'Tokyo');
    });
    await waitServer((s) => s.cities.join() === 'Berlin,Sydney,Tokyo', 'Berlin,Sydney,Tokyo');
    await reconnect(phone);
    await waitCards(phone, { has: ['Sydney', 'Tokyo'] }, 25000);
    return 'Sydney and Tokyo appeared on the phone';
  });

  await step('both devices edit while apart, then merge: a delete on one + a reorder on the other both survive', async () => {
    await goList(phone);
    await goList(laptop);
    phone.blocked = true;
    laptop.blocked = true;

    phone.page.once('dialog', (dlg) => dlg.accept());
    await cardButton(phone, 'Berlin', 'button[aria-label="Delete"]'); // phone (offline): delete Berlin
    await cardButton(laptop, 'Tokyo', 'button[aria-label="Move up"]'); // laptop (offline): Tokyo above Sydney
    await sleep(1200);
    await waitCards(phone, { hasNot: ['Berlin'] });
    assert((await cardNames(laptop)).join().includes('Tokyo,Sydney'), `laptop order: ${(await cardNames(laptop)).join()}`);

    phone.blocked = false;
    laptop.blocked = false;
    await reconnect(phone);
    await reconnect(laptop);
    await waitServer((s) => s.cities.join() === 'Tokyo,Sydney', 'Tokyo,Sydney');
    await reconnect(phone); // one more round so each has pulled the other's change
    await reconnect(laptop);
    await waitCards(phone, { has: ['Tokyo', 'Sydney'], hasNot: ['Berlin'] }, 25000);
    await waitCards(laptop, { has: ['Tokyo', 'Sydney'], hasNot: ['Berlin'] }, 25000);
    const order = (names) => names.filter((n) => /^(Tokyo|Sydney)$/.test(n)).join();
    assert(order(await cardNames(phone)) === 'Tokyo,Sydney', `phone: ${(await cardNames(phone)).join()}`);
    assert(order(await cardNames(laptop)) === 'Tokyo,Sydney', `laptop: ${(await cardNames(laptop)).join()}`);
    await phone.page.screenshot({ path: path.join(SHOTS, '5-merged-phone.png') });
    return 'phone, laptop and server all agree: Tokyo, Sydney';
  });

  console.log('\nSettings');
  await step('units follow the account to the other device; theme stays on each device', async () => {
    await goList(phone);
    await phone.page.click('button[aria-label="Settings"]');
    await phone.page.waitForFunction(() => location.pathname === '/settings', { timeout: 10000 });
    await phone.page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '°F').click()); // units → imperial
    await phone.page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Dark').click()); // theme → dark (this device only)
    const server = await waitServer((s) => s.prefs && s.prefs.fields.units.value === 'imperial', 'units=imperial');
    assert(!('theme' in server.prefs.fields), 'theme must not be synced');

    await reconnect(laptop);
    await laptop.page.waitForFunction(() => JSON.parse(localStorage.getItem('quarc_weather_prefs') || '{}').units === 'imperial', { timeout: 25000 });
    const laptopPrefs = await laptop.page.evaluate(() => JSON.parse(localStorage.getItem('quarc_weather_prefs') || '{}'));
    assert(laptopPrefs.theme !== 'dark', `laptop theme leaked: ${laptopPrefs.theme}`);
    return 'units synced, theme stayed on the phone';
  });

  console.log('\nRuntime errors');
  await step('no page exceptions or console errors on either device', async () => {
    const all = [...phone.pageErrors, ...phone.errors, ...laptop.pageErrors, ...laptop.errors];
    assert(all.length === 0, all.slice(0, 3).join(' | '));
    return 'none';
  });

  await browser.close();
  console.log('\n=============================================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
