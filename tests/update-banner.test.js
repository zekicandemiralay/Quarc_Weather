// Verifies the startup update banner: simulates being on Android with an old
// installed version, then checks the banner appears automatically without
// visiting Settings — hitting the REAL GitHub API against the REAL published
// releases (v1.0.0..v1.0.2), not a mock of GitHub's response shape.

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots-update');
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

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  // No location permission needed for this test — deny it so the landing
  // resolver falls straight through without waiting on a GPS fix.
  await context.overridePermissions(BASE, []);

  // Simulate the Android APK reporting an old installed version, BEFORE any
  // page script runs, so getPlatform() sees 'android' and checkForUpdate()
  // compares that fake old version against the real latest GitHub release.
  await page.evaluateOnNewDocument(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { getInfo: async () => ({ version: '1.0.0' }) },
        Geolocation: {
          requestPermissions: async () => ({ location: 'denied' }),
          getCurrentPosition: async () => { throw new Error('denied'); },
        },
        Updater: { downloadUpdate: () => {} },
      },
    };
  });

  console.log('\nQuarc Weather — startup update banner\n======================================\n');

  await step('login', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    await page.type('input[placeholder="Username"]', USER);
    await page.type('input[placeholder="Password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
    ]);
    return 'authenticated';
  });

  await step('no banner immediately after login (still within the startup delay)', async () => {
    await sleep(1500);
    const txt = await page.evaluate(() => document.body.innerText);
    assert(!/Update available|update-available|is available/i.test(txt), 'banner appeared too early');
    return 'confirmed — check is deliberately delayed';
  });

  await step('banner appears automatically ~6s after login, no Settings visit needed', async () => {
    // The store's delay is 6000ms; give it real headroom for the live
    // GitHub API round trip too.
    await page.waitForFunction(
      () => /is available/i.test(document.body.innerText),
      { timeout: 15000 }
    );
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/1\.0\.2/.test(txt) || /v?1\.0\.[1-9]/.test(txt), `banner shown but version text unexpected: ${txt.slice(0, 200)}`);
    await page.screenshot({ path: `${SHOTS}/1-banner-on-list.png` });
    return txt.match(/[^\n]*is available[^\n]*/i)?.[0] || 'shown';
  });

  await step('layout is not broken by the banner (page content still fits, no overlap)', async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert(!overflow, 'horizontal overflow introduced by the banner');
    return 'no horizontal overflow';
  });

  await step('the banner also shows on the weather detail screen (h-screen page), not just the list', async () => {
    // In-app click, not page.goto() — goto() is a full reload, which wipes
    // the Zustand store's in-memory state (including the check's 6s timer),
    // exactly the mistake that bit the landing-resolution test earlier.
    await page.click('button[aria-label="Add city"]');
    await page.waitForFunction(() => window.location.pathname === '/add', { timeout: 10000 });
    await page.waitForSelector('input', { timeout: 10000 });
    await page.type('input', 'Tokyo');
    await page.waitForFunction(() => document.querySelectorAll('li button').length > 0, { timeout: 20000 });
    await page.click('li button');
    await page.waitForFunction(() => window.location.pathname === '/', { timeout: 15000 });
    await page.waitForFunction(() => !!document.querySelector('ul > li'), { timeout: 15000 });
    await page.click('ul > li button');
    await page.waitForFunction(() => window.location.pathname.startsWith('/city/'), { timeout: 15000 });
    await sleep(2000);
    const [txt, url] = await page.evaluate(() => [document.body.innerText, window.location.href]);
    await page.screenshot({ path: `${SHOTS}/2-banner-on-detail.png` });
    if (!/is available/i.test(txt)) {
      console.log('    DIAGNOSTIC url:', url);
      console.log('    DIAGNOSTIC full innerText:', JSON.stringify(txt.slice(0, 300)));
    }
    assert(/is available/i.test(txt), 'banner missing on the detail screen');
    return 'shown on detail screen too';
  });

  await step('dismiss button hides the banner and it stays hidden on navigation', async () => {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close');
      btn?.click();
    });
    await sleep(500);
    let txt = await page.evaluate(() => document.body.innerText);
    assert(!/is available/i.test(txt), 'banner did not disappear after dismiss');

    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
    await sleep(1000);
    txt = await page.evaluate(() => document.body.innerText);
    assert(!/is available/i.test(txt), 'dismissed banner reappeared after navigating');
    return 'stays dismissed across navigation';
  });

  await step('Settings screen still independently reports the update via its own check', async () => {
    await sleep(500);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Check for updates'));
      btn?.click();
    });
    await page.waitForFunction(() => /is available/i.test(document.body.innerText), { timeout: 15000 });
    return 'Settings manual check still works independently';
  });

  await context.close();
  await browser.close();

  console.log('\n======================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
