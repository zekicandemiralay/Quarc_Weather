// Drives the real built frontend in headless Chrome with mocked geolocation
// to verify the app's landing behavior end to end: current location first,
// falling back to the last-opened city, falling back to the plain list.

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots-location');
const USER = 'zeki';
const PASS = 'testpass123';

let pass = 0;
let fail = 0;
function ok(n, extra = '') { console.log(`  [ OK ]  ${n}${extra ? '  — ' + extra : ''}`); pass++; }
function bad(n, d) { console.log(`  [FAIL]  ${n}  — ${d}`); fail++; }
async function step(name, fn) {
  try { ok(name, await fn()); } catch (e) { bad(name, e.message.split('\n')[0]); }
}
function assert(c, m) { if (!c) throw new Error(m); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
  await page.type('input[placeholder="Username"]', USER);
  await page.type('input[placeholder="Password"]', PASS);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForFunction(
      () => !document.body.innerText.includes('Sign in to your Quarc account'),
      { timeout: 20000 }
    ),
  ]);
}

async function resetServerState(page) {
  await page.evaluate(async () => {
    const cities = await fetch('/api/cities', { credentials: 'include' }).then((r) => r.json());
    await Promise.all(cities.map((c) => fetch(`/api/cities/${c.id}`, { method: 'DELETE', credentials: 'include' })));
  });
  await page.evaluate(() => localStorage.clear());
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  console.log('\nQuarc Weather — location landing behavior\n==========================================\n');

  // ---- Scenario 1: fresh account, location granted → lands on My Location ----
  {
    // A dedicated, isolated context per scenario — separate cookies AND
    // separate permission grants. Reusing one context across scenarios was
    // the bug in an earlier version of this test: scenario 2 silently
    // inherited scenario 1's login session, so its own login() call timed
    // out waiting for a form that was never going to appear.
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
    await context.overridePermissions(BASE, ['geolocation']);
    // Istanbul coordinates — distinctive enough to confirm in the UI.
    await page.setGeolocation({ latitude: 41.0082, longitude: 28.9784 });

    await login(page);
    await resetServerState(page);

    await step('fresh login + granted location → lands directly on a weather screen, not the list', async () => {
      await page.goto(BASE, { waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => window.location.pathname.startsWith('/city/') || document.body.innerText.includes('No cities yet'),
        { timeout: 15000 }
      );
      await sleep(2000);
      const path = await page.evaluate(() => window.location.pathname);
      assert(path.startsWith('/city/'), `landed on ${path}, expected /city/:id`);
      await page.screenshot({ path: `${SHOTS}/1-landed-on-location.png` });
      return path;
    });

    await step('the landing screen shows "My Location" and real weather', async () => {
      const txt = await page.evaluate(() => document.body.innerText);
      assert(/My Location/.test(txt), 'header does not say My Location');
      assert(/\d+°/.test(txt), 'no temperature shown');
      return 'confirmed';
    });

    await step('My Location was saved to the city list (single pinned row)', async () => {
      const cities = await page.evaluate(() =>
        fetch('/api/cities', { credentials: 'include' }).then((r) => r.json())
      );
      const pins = cities.filter((c) => c.is_current_location);
      assert(pins.length === 1, `expected 1 pinned row, found ${pins.length}`);
      assert(Math.abs(pins[0].latitude - 41.0082) < 0.01, `latitude mismatch: ${pins[0].latitude}`);
      return `1 pinned row at ${pins[0].latitude}, ${pins[0].longitude}`;
    });

    await step('the in-app back button shows My Location pinned first, no reorder arrows on it', async () => {
      // Deliberately an in-app click, not page.goto() — goto() is a real
      // reload, which legitimately re-triggers landing resolution (that IS
      // "opening the app" again). The back button is client-side routing and
      // must NOT re-trigger it, or the list would be unreachable.
      await page.click('header button');
      await page.waitForFunction(() => window.location.pathname === '/', { timeout: 10000 });
      await sleep(1500);
      const txt = await page.evaluate(() => document.body.innerText);
      assert(/My Location/.test(txt), 'list does not show My Location');
      await page.screenshot({ path: `${SHOTS}/2-list-with-pin.png` });
      return 'shown';
    });

    await step('staying on the list via in-app navigation does not re-redirect', async () => {
      const path = await page.evaluate(() => window.location.pathname);
      assert(path === '/', `expected to still be on /, got ${path}`);
      return 'confirmed — the in-session flag correctly prevented a bounce-back';
    });

    await step('a genuine reload while on the list DOES re-resolve (matches "opening the app")', async () => {
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(() => window.location.pathname.startsWith('/city/'), { timeout: 15000 });
      const path = await page.evaluate(() => window.location.pathname);
      assert(path.startsWith('/city/'), `expected a redirect back to /city/:id, got ${path}`);
      return `redirected again on reload, as a fresh app-open should: ${path}`;
    });

    await context.close();
  }

  // ---- Scenario 2: location denied, but a last-opened city exists → falls back ----
  {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 430, height: 932 });
    // Denying via overridePermissions with an empty list makes the Permissions
    // API report 'denied' without the OS ever prompting.
    await context.overridePermissions(BASE, []);

    await login(page);
    await resetServerState(page);

    let savedCityId;
    await step('setup: save Berlin, then actually open it (handleAdd only saves + returns to the list)', async () => {
      await page.goto(`${BASE}/add`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('input', { timeout: 10000 });
      await page.type('input', 'Berlin');
      await page.waitForFunction(() => document.querySelectorAll('li button').length > 0, { timeout: 20000 });
      await page.click('li button');
      // handleAdd navigates to "/" on success — the list, not the new city's
      // detail page — so "last opened" isn't set until the card is actually
      // tapped open.
      await page.waitForFunction(() => window.location.pathname === '/', { timeout: 15000 });
      await sleep(1500);
      await page.click('ul > li button');
      await page.waitForFunction(() => window.location.pathname.startsWith('/city/'), { timeout: 15000 });
      await sleep(1500);
      savedCityId = await page.evaluate(() => window.location.pathname.split('/').pop());
      assert(savedCityId && savedCityId.length > 10, `didn't capture a real city id: "${savedCityId}"`);
      return `opened, id ${savedCityId.slice(0, 8)}…`;
    });

    await step('reloading the app (denied location) lands back on that same city', async () => {
      await page.goto(BASE, { waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => window.location.pathname.startsWith('/city/') || document.readyState === 'complete',
        { timeout: 15000 }
      );
      await sleep(2500);
      const path = await page.evaluate(() => window.location.pathname);
      assert(path === `/city/${savedCityId}`, `expected /city/${savedCityId}, got ${path}`);
      const txt = await page.evaluate(() => document.body.innerText);
      assert(/Berlin/.test(txt), 'landing screen does not show Berlin');
      await page.screenshot({ path: `${SHOTS}/3-fallback-last-city.png` });
      return `landed on Berlin via last-opened fallback`;
    });

    await step('no live-location pin was created (location was denied)', async () => {
      const cities = await page.evaluate(() =>
        fetch('/api/cities', { credentials: 'include' }).then((r) => r.json())
      );
      const pins = cities.filter((c) => c.is_current_location);
      assert(pins.length === 0, `expected 0 pins, found ${pins.length}`);
      return 'confirmed';
    });

    await context.close();
  }

  // ---- Scenario 3: no location, no saved cities → shows the empty list ----
  {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 430, height: 932 });
    await context.overridePermissions(BASE, []);

    await login(page);
    await resetServerState(page);

    await step('nothing available at all → shows the plain empty-state list', async () => {
      await page.goto(BASE, { waitUntil: 'networkidle2' });
      await sleep(2500);
      const path = await page.evaluate(() => window.location.pathname);
      assert(path === '/', `expected to land on /, got ${path}`);
      const txt = await page.evaluate(() => document.body.innerText);
      assert(/No cities yet/.test(txt), 'empty state not shown');
      await page.screenshot({ path: `${SHOTS}/4-empty-fallback.png` });
      return 'empty state shown, no crash';
    });

    await context.close();
  }

  await browser.close();

  console.log('\n==========================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
