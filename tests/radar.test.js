// Exercises the precipitation radar card end to end against the REAL
// RainViewer + Esri tile services (both free, no key, verified reachable —
// and the Esri tiles actually inspected pixel-by-pixel, not just checked
// for a 200 status, after CartoDB's equivalent free tiles turned out to
// silently stamp an "API KEY REQUIRED" watermark across every image while
// still answering 200) — no mocks, matching the rest of this suite's
// philosophy.

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots-radar');
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
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

  console.log('\nQuarc Weather — precipitation radar\n====================================\n');

  await step('login and open a city', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    await page.type('input[placeholder="Username"]', USER);
    await page.type('input[placeholder="Password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
    ]);
    await page.evaluate(async () => {
      const cities = await fetch('/api/cities', { credentials: 'include' }).then((r) => r.json());
      await Promise.all(cities.map((c) => fetch(`/api/cities/${c.id}`, { method: 'DELETE', credentials: 'include' })));
    });
    await page.goto(`${BASE}/add`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input', { timeout: 10000 });
    await page.type('input', 'Istanbul');
    await page.waitForFunction(() => document.querySelectorAll('li button').length > 0, { timeout: 20000 });
    await page.click('li button');
    await page.waitForFunction(() => window.location.pathname === '/', { timeout: 15000 });
    await page.waitForFunction(() => !!document.querySelector('ul > li'), { timeout: 15000 });
    await page.click('ul > li button');
    await page.waitForFunction(() => window.location.pathname.startsWith('/city/'), { timeout: 15000 });
    await sleep(500);
    return 'opened Istanbul';
  });

  await step('radar card is present but collapsed (no map, no tile requests) by default', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/radar/i.test(txt), `no "radar" text found: ${txt.slice(0, 200)}`);
    const leafletContainers = await page.evaluate(() => document.querySelectorAll('.leaflet-container').length);
    assert(leafletContainers === 0, `expected no map mounted before expanding, found ${leafletContainers}`);
    return 'card visible, map not mounted';
  });

  await step('tapping the radar card expands it, mounts a real Leaflet map, and loads real Esri basemap tiles', async () => {
    const tileResponses = [];
    const onResp = (res) => {
      if (res.url().includes('server.arcgisonline.com')) tileResponses.push(res.status());
    };
    page.on('response', onResp);

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /radar/i.test(b.textContent));
      btn?.click();
    });
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    await sleep(2500);

    page.off('response', onResp);
    assert(tileResponses.length > 0, 'no Esri tile requests observed during expand');
    assert(tileResponses.every((s) => s === 200), `expected all 200s, got ${tileResponses.join(',')}`);
    return `map mounted, ${tileResponses.length} basemap tiles loaded, all 200`;
  });

  await step('radar frames load from RainViewer and the play/pause control works', async () => {
    await page.waitForFunction(
      () => !!document.querySelector('input[type="range"]'),
      { timeout: 15000 }
    );
    const rainviewerTiles = await page.evaluate(async () => {
      // Can't easily intercept past requests retroactively — instead confirm
      // the app's own state reached "ready" by checking the slider's max
      // attribute is > 0 (only set once frames actually loaded).
      const input = document.querySelector('input[type="range"]');
      return input ? Number(input.max) : -1;
    });
    assert(rainviewerTiles > 0, `expected a multi-frame radar loop, slider max was ${rainviewerTiles}`);

    const playBtn = await page.$('button[aria-label="Pause"], button[aria-label="Play"]');
    assert(playBtn, 'no play/pause button found');
    const before = await page.evaluate((el) => el.getAttribute('aria-label'), playBtn);
    await playBtn.click();
    const after = await page.evaluate((el) => el.getAttribute('aria-label'), playBtn);
    assert(before !== after, `expected aria-label to toggle, stayed "${before}"`);

    await page.screenshot({ path: `${SHOTS}/1-radar-expanded.png` });
    return `${rainviewerTiles + 1} radar frames loaded, play/pause toggled ${before} -> ${after}`;
  });

  await step('collapsing and re-expanding tears down and remounts cleanly (no console errors)', async () => {
    const errors = [];
    const onErr = (e) => errors.push(e.message);
    page.on('pageerror', onErr);

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /radar/i.test(b.textContent));
      btn?.click();
    });
    await sleep(300);
    const gone = await page.evaluate(() => document.querySelectorAll('.leaflet-container').length);
    assert(gone === 0, `expected map removed after collapse, found ${gone}`);

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /radar/i.test(b.textContent));
      btn?.click();
    });
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    await sleep(1000);

    page.off('pageerror', onErr);
    assert(errors.length === 0, `page errors on remount: ${errors.join('; ')}`);
    return 'clean teardown + remount, no errors';
  });

  await browser.close();

  console.log('\n====================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
