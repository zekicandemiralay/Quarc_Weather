// Shared plumbing for the browser suites. Every suite drives the REAL built app in headless Chrome against the real
// stack (quarc-auth :3902, the backend :3904, the app :4173) and the real weather provider.
//
//   "device"   one isolated browser context (its own storage) — i.e. one phone/laptop signed in as the test account
//   blocked    every request to the Quarc server (/api/*) fails, exactly like Tailscale being off. The weather
//              provider, city search and place names live on other hosts and keep working.
//   forecast   a hook to ALTER the real forecast on its way in (weather code, sunrise times, storms...), because the
//              weather right now is whatever it is. The test fetches the real forecast itself and edits it, so the
//              screen is still rendering genuine data with one thing changed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const jwt = require('jsonwebtoken');

const BASE = 'http://127.0.0.1:4173';
const BACKEND = 'http://127.0.0.1:3904';
const SECRET = process.env.JWT_SECRET || 'testsecret';
const USER = 'zeki';
const PASS = 'testpass123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- city search ---------------------------------------------------------------------------------------------------
// Almost every suite starts by adding a city, which asks Open-Meteo's geocoder. From a shared CI runner that endpoint
// has been seen to give no answer for a while (the first attempt of several suites timed out waiting for search
// results, the retry 30 s later passed) — and it is not what those suites are about. So the answer is the REAL
// one, fetched from the live geocoder ONCE per distinct query (with retries, outside the 20 s the page would wait),
// kept for a day in a file shared by all the suites, and replayed. A suite can opt out with `device.liveGeocoder = true`.
const GEOCODER_HOST = 'geocoding-api.open-meteo.com';
const GEOCODE_CACHE = path.join(os.tmpdir(), 'quarc-weather-test-geocode-cache.json');
const GEOCODE_TTL_MS = 24 * 3600 * 1000;

function readGeocodeCache() {
  try { return JSON.parse(fs.readFileSync(GEOCODE_CACHE, 'utf8')); } catch { return {}; }
}

async function cachedGeocode(url) {
  const hit = readGeocodeCache()[url];
  if (hit && Date.now() - hit.at < GEOCODE_TTL_MS) return hit.body;

  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`geocoder answered ${res.status}`);
      const body = await res.text();
      JSON.parse(body); // only a real JSON answer is worth keeping
      const cache = readGeocodeCache();
      cache[url] = { at: Date.now(), body };
      try { fs.writeFileSync(GEOCODE_CACHE, JSON.stringify(cache)); } catch { /* a read-only temp dir only costs speed */ }
      return body;
    } catch (e) {
      last = e;
      await sleep(1000 * 2 ** attempt); // 1, 2, 4, 8 s
    }
  }
  throw last;
}

// --- a tiny test runner with the suites' usual output ------------------------------------------------------------
function createRunner(title) {
  let pass = 0;
  let fail = 0;
  const underline = '='.repeat(title.length);
  console.log(`\n${title}\n${underline}\n`);
  return {
    section: (name) => console.log(`\n${name}`),
    assert(cond, msg) { if (!cond) throw new Error(msg); },
    async step(name, fn) {
      try {
        const extra = await fn();
        console.log(`  [ OK ]  ${name}${extra ? '  — ' + extra : ''}`);
        pass++;
      } catch (e) {
        console.log(`  [FAIL]  ${name}  — ${e.message.split('\n')[0]}`);
        fail++;
      }
    },
    finish(extra = '') {
      console.log(`\n${underline}`);
      console.log(`  ${pass} passed, ${fail} failed`);
      if (extra) console.log(`  ${extra}`);
      console.log('');
      process.exit(fail === 0 ? 0 : 1);
    },
  };
}

function launch() {
  return puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

// --- devices -----------------------------------------------------------------------------------------------------
/**
 * @param geo       {latitude, longitude} for a live GPS fix, or null to DENY location
 * @param viewport  default: a phone
 * @param timezone  emulated browser timezone (to prove the app uses the CITY's, not the device's)
 */
async function newDevice(browser, { name = 'device', geo = null, viewport, timezone, touch = false, reducedMotion = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport || { width: 430, height: 932, deviceScaleFactor: 1, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  if (timezone) await page.emulateTimezone(timezone);
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

  const device = {
    name, context, page,
    blocked: false,
    providerBlocked: false, // the weather provider unreachable (but the Quarc server fine)
    forecast: { mutate: null }, // (json) => json, applied to every forecast response
    hits: { provider: 0, airQuality: 0, quarcWeather: 0, apiCalls: [] },
    errors: [],
    pageErrors: [],
  };

  if (geo) {
    await context.overridePermissions(BASE, ['geolocation']);
    await page.setGeolocation(geo);
  } else {
    await context.overridePermissions(BASE, []); // denied: the app lands on the list
  }

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname === 'api.open-meteo.com') device.hits.provider++;
    if (u.hostname === 'air-quality-api.open-meteo.com') device.hits.airQuality++;
    if (u.origin === BASE && u.pathname.startsWith('/api/')) device.hits.apiCalls.push(u.pathname);
    if (u.origin === BASE && /\/api\/(weather|geocode)/.test(u.pathname)) device.hits.quarcWeather++;

    // "Tailscale off".
    if (device.blocked && u.origin === BASE && u.pathname.startsWith('/api/')) return req.abort('connectionrefused');
    // The weather provider down.
    if (device.providerBlocked && /open-meteo\.com$/.test(u.hostname)) return req.abort('connectionrefused');

    // City search: a real Open-Meteo answer, fetched once per distinct query per run (see cachedGeocode).
    if (u.hostname === GEOCODER_HOST && !device.liveGeocoder) {
      (async () => {
        try {
          await req.respond({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: await cachedGeocode(req.url()),
          });
        } catch (e) {
          await req.continue().catch(() => {}); // no answer to replay: let the browser ask for itself
        }
      })();
      return undefined;
    }

    // Alter the real forecast on its way in.
    if (device.forecast.mutate && u.hostname === 'api.open-meteo.com' && u.pathname === '/v1/forecast') {
      (async () => {
        try {
          const upstream = await fetch(req.url());
          const json = device.forecast.mutate(await upstream.json());
          await req.respond({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(json),
          });
        } catch (e) {
          await req.continue().catch(() => {});
        }
      })();
      return undefined;
    }
    return req.continue();
  });

  page.on('pageerror', (e) => device.pageErrors.push(e.message));
  page.on('console', (m) => {
    // Network failures surface as bare "Failed to load resource" errors with no URL — and some are deliberate
    // (a blocked server, a 401 before login) — so only genuine script errors count.
    if (m.type() === 'error' && !/Failed to load resource|ERR_|status of 401/.test(m.text())) device.errors.push(m.text());
  });
  return device;
}

async function login(d, { language } = {}) {
  await d.page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await d.page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
  await d.page.type('input[placeholder="Username"]', USER);
  await d.page.type('input[placeholder="Password"]', PASS);
  await Promise.all([
    d.page.click('button[type="submit"]'),
    d.page.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
  ]);
  if (language) await sleep(300);
}

// --- the server's view of the account ---------------------------------------------------------------------------
const tokenFor = (userId) => jwt.sign({ id: userId, username: USER, role: 'admin' }, SECRET);
const asUser = (userId) => ({ headers: { Cookie: `token=${tokenFor(userId)}`, 'Content-Type': 'application/json' } });

async function currentUserId(d) {
  return d.page.evaluate(async () => (await (await fetch('/api/auth/me', { credentials: 'include' })).json()).id);
}

async function serverState(userId) {
  const j = await (await fetch(`${BACKEND}/api/sync/pull?since=`, asUser(userId))).json();
  const live = j.cities.filter((c) => !c.is_deleted).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  return { cities: live.map((c) => c.name), all: j.cities, prefs: j.prefs };
}

/** Deletes every city and resets the settings, stamped NOW so edits the test makes next still win. */
async function resetAccount(userId) {
  const j = await (await fetch(`${BACKEND}/api/sync/pull?since=`, asUser(userId))).json();
  const now = new Date().toISOString();
  const mutations = j.cities.filter((c) => !c.is_deleted).map((c) => ({ table: 'cities', id: c.id, op: 'delete', client_updated_at: now }));
  if (mutations.length) await fetch(`${BACKEND}/api/sync/push`, { ...asUser(userId), method: 'POST', body: JSON.stringify({ mutations }) });
  const fields = {};
  for (const [k, v] of [['units', 'metric'], ['wind_unit', 'kmh'], ['precip_unit', 'mm'], ['language', 'en']]) fields[k] = { value: v, t: now };
  await sleep(50);
  await fetch(`${BACKEND}/api/sync/push`, {
    ...asUser(userId), method: 'POST',
    body: JSON.stringify({ mutations: [{ table: 'prefs', id: 'prefs', op: 'upsert', client_updated_at: now, data: { fields } }] }),
  });
}

async function waitServer(userId, check, what, timeout = 25000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await serverState(userId);
    if (check(last)) return last;
    await sleep(500);
  }
  throw new Error(`server never reached "${what}" (has: ${last.cities.join(',')})`);
}

// --- navigating like a person -----------------------------------------------------------------------------------
const text = (d) => d.page.evaluate(() => document.body.innerText);
const reconnect = (d) => d.page.evaluate(() => window.dispatchEvent(new Event('online')));
const noBadge = (d, timeout = 25000) => d.page.waitForFunction(() => !document.querySelector('[data-testid="sync-badge"]'), { timeout });
const badge = (d) => d.page.$eval('[data-testid="sync-badge"]', (e) => ({ text: e.textContent.trim(), status: e.dataset.status })).catch(() => null);

const cardNames = (d) => d.page.$$eval('ul > li', (lis) => lis.map((li) => li.querySelector('p span.truncate')?.textContent?.trim() || '').filter(Boolean));
const waitCards = (d, { has = [], hasNot = [] }, timeout = 20000) =>
  d.page.waitForFunction(
    (wanted, unwanted) => {
      const names = Array.from(document.querySelectorAll('ul > li')).map((li) => li.querySelector('p span.truncate')?.textContent?.trim() || '').filter(Boolean);
      return wanted.every((w) => names.some((n) => n.includes(w))) && unwanted.every((u) => !names.some((n) => n.includes(u)));
    },
    { timeout }, has, hasNot
  );

/** Opens the app and ends on the city LIST (a device with a GPS fix opens on My Location, so press back, like a person). */
async function goList(d) {
  await d.page.goto(BASE, { waitUntil: 'networkidle2' });
  await d.page.waitForSelector('button[aria-label="Add city"], .sky h1, p', { timeout: 20000 });
  await sleep(800);
  if (await d.page.$('.sky h1')) {
    await d.page.evaluate(() => Array.from(document.querySelectorAll('header button')).find((b) => b.innerText.includes('‹'))?.click());
  }
  await d.page.waitForSelector('button[aria-label="Add city"]', { timeout: 15000 });
}

/** From the list: tap +, search, pick the first hit — inside the app, no page reload. */
async function addCityByName(d, query, expectName) {
  await d.page.click('button[aria-label="Add city"]');
  await d.page.waitForSelector('input', { timeout: 10000 });
  await d.page.type('input', query);
  await d.page.waitForFunction(() => document.querySelectorAll('li button').length > 0, { timeout: 20000 });
  const first = await d.page.$eval('li button p', (p) => p.textContent.trim());
  if (expectName && !first.includes(expectName)) throw new Error(`first search hit was "${first}"`);
  await d.page.click('li button');
  await d.page.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
}

/** Clicks the card of the named city (or one of its buttons) on the list. */
const cardButton = (d, name, selector = 'button') =>
  d.page.evaluate(
    (n, sel) => {
      const li = Array.from(document.querySelectorAll('ul > li')).find((x) => x.textContent.includes(n));
      li.querySelector(sel).click();
    },
    name, selector
  );

// --- the forecast cache (IndexedDB 'quarc-weather' › 'forecasts') ---------------------------------------------------
// A cached forecast is served for 10 minutes, which would hide the weather a test injects — so tests clear it, or
// age it past the freshness windows to exercise refresh and stale paths.
const withForecastStore = (d, body) =>
  d.page.evaluate(
    (src) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('quarc-weather');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('forecasts', 'readwrite');
          // eslint-disable-next-line no-new-func
          new Function('store', `(${src})(store)`)(tx.objectStore('forecasts'));
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    body.toString()
  );

const clearForecastCache = (d) => withForecastStore(d, (store) => store.clear());

/** Makes every cached forecast `ms` older than it is. */
const ageForecastCache = (d, ms) =>
  d.page.evaluate(
    (age) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('quarc-weather');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('forecasts', 'readwrite');
          const req = tx.objectStore('forecasts').openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            cursor.update({ ...cursor.value, at: cursor.value.at - age });
            cursor.continue();
          };
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    ms
  );

/** Signs in on a fresh device, resets the account and lands on the (empty) list. */
async function freshSession(browser, opts = {}) {
  const d = await newDevice(browser, opts);
  await login(d);
  d.userId = await currentUserId(d);
  await resetAccount(d.userId);
  // The device signed in BEFORE the reset, so it may have pulled a leftover (say Turkish) language from an earlier
  // run. Nudge a sync and wait until it has the reset's English, so the suites' English selectors can rely on it.
  await reconnect(d);
  await d.page
    .waitForFunction(() => { try { return JSON.parse(localStorage.getItem('quarc_weather_prefs') || '{}').language === 'en'; } catch { return false; } }, { timeout: 10000 })
    .catch(() => {});
  return d;
}

/**
 * Resets the test account (cities and settings) with a throwaway sign-in, for suites that build their own browser
 * context (to inject a fake native bridge) and must start signed OUT but against a clean, English account.
 */
async function cleanAccount(browser) {
  const d = await newDevice(browser, { name: 'cleanup' });
  try {
    await login(d);
    await resetAccount(await currentUserId(d));
  } finally {
    await d.context.close();
  }
}

/** Add a city, then open its weather screen. */
async function openCityByName(d, query, expectName) {
  await goList(d);
  await addCityByName(d, query, expectName);
  await waitCards(d, { has: [expectName || query] });
  await cardButton(d, expectName || query);
  await d.page.waitForFunction(() => location.pathname.startsWith('/city/'), { timeout: 10000 });
  await d.page.waitForSelector('.sky h1', { timeout: 20000 });
  await sleep(500);
}

module.exports = {
  BASE, BACKEND, USER, PASS, sleep, createRunner, launch, newDevice, login, currentUserId, serverState, resetAccount,
  waitServer, text, reconnect, noBadge, badge, cardNames, waitCards, goList, addCityByName, cardButton, freshSession,
  openCityByName, tokenFor, clearForecastCache, ageForecastCache, cleanAccount,
};
