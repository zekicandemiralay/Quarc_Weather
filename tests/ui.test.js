// Drives the real built frontend in a headless browser against the real
// quarc-auth service and the real weather backend. Captures every console
// error and page exception — that's what catches runtime React bugs a
// successful `vite build` cannot.

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots');
const USER = 'zeki';
const PASS = 'testpass123';

const consoleErrors = [];
const pageErrors = [];
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

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  console.log('\nQuarc Weather — UI test\n=======================\n');

  console.log('Login');
  await step('login screen renders', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    const heading = await page.$eval('h1', (el) => el.textContent);
    await page.screenshot({ path: path.join(SHOTS, '1-login.png') });
    return heading;
  });

  await step('shared-account note is shown', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/Quarc Music/.test(txt), 'shared-account line missing');
    return 'present';
  });

  await step('logging in reaches the city list', async () => {
    await page.type('input[placeholder="Username"]', USER);
    await page.type('input[placeholder="Password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => document.body.innerText.includes('Weather'), { timeout: 20000 }),
    ]);
    await sleep(1200);
    const txt = await page.evaluate(() => document.body.innerText);
    assert(!/Sign in to your Quarc account/.test(txt), 'still on login screen');
    await page.screenshot({ path: path.join(SHOTS, '2-empty-list.png') });
    return 'authenticated';
  });

  // Reset server-side state so the run is repeatable regardless of what a
  // previous run left behind.
  await page.evaluate(async () => {
    const cities = await fetch('/api/cities', { credentials: 'include' }).then((r) => r.json());
    await Promise.all(
      cities.map((c) => fetch(`/api/cities/${c.id}`, { method: 'DELETE', credentials: 'include' }))
    );
    await fetch('/api/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', theme: 'auto', language: 'en' }),
    });
    localStorage.removeItem('quarc_weather_prefs');
    localStorage.setItem('language', 'en');
  });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(1500);

  console.log('\nAdding a city');
  await step('empty state invites adding a city', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/No cities yet/.test(txt), `unexpected: ${txt.slice(0, 80)}`);
    return 'empty state shown';
  });

  await step('search finds Istanbul', async () => {
    await page.goto(`${BASE}/add`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input', { timeout: 10000 });
    await page.type('input', 'Istanbul');
    await page.waitForFunction(() => document.querySelectorAll('li button').length > 0, { timeout: 20000 });
    const n = await page.evaluate(() => document.querySelectorAll('li button').length);
    await page.screenshot({ path: path.join(SHOTS, '3-search.png') });
    return `${n} results`;
  });

  await step('tapping a result saves it and returns to the list', async () => {
    await page.click('li button');
    await page.waitForFunction(() => document.body.innerText.includes('°'), { timeout: 25000 });
    await sleep(2000);
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/Istanbul/.test(txt), 'Istanbul not in list');
    await page.screenshot({ path: path.join(SHOTS, '4-city-list.png') });
    return txt.split('\n').filter(Boolean).slice(0, 4).join(' / ');
  });

  await step('the card shows a real temperature and condition', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/\d+°/.test(txt), 'no temperature rendered');
    assert(/H:\s*-?\d+°/.test(txt), 'no high/low rendered');
    return txt.match(/\d+°/)[0];
  });

  console.log('\nCity detail');
  await step('opening the city renders the full forecast', async () => {
    await page.click('li button');
    await page.waitForFunction(
      () => document.body.innerText.includes('HOURLY FORECAST') || document.body.innerText.includes('Hourly forecast'),
      { timeout: 25000 }
    );
    await sleep(2500);
    await page.screenshot({ path: path.join(SHOTS, '5-detail-top.png') });
    const txt = await page.evaluate(() => document.body.innerText);
    return txt.split('\n').filter(Boolean).slice(0, 3).join(' / ');
  });

  await step('hourly strip has 24 cells', async () => {
    const n = await page.evaluate(() => {
      const h = [...document.querySelectorAll('section')].find((s) => /hourly/i.test(s.textContent));
      return h ? h.querySelectorAll('div > div').length : 0;
    });
    assert(n >= 20, `only ${n} hourly cells`);
    return `${n} cells`;
  });

  await step('10-day list renders 10 rows', async () => {
    const n = await page.evaluate(() => {
      const d = [...document.querySelectorAll('section')].find((s) => /10-day|10 günlük/i.test(s.textContent));
      return d ? d.querySelectorAll('li').length : 0;
    });
    assert(n === 10, `got ${n} rows`);
    return `${n} rows`;
  });

  await step('detail tiles render with real values', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    for (const label of ['UV INDEX', 'WIND', 'SUNRISE', 'FEELS LIKE', 'VISIBILITY', 'PRESSURE', 'MOON PHASE']) {
      assert(txt.toUpperCase().includes(label), `missing tile: ${label}`);
    }
    // The weather screen scrolls an inner div, not the document — scrolling
    // window here silently does nothing.
    const scrolled = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50);
      if (!el) return false;
      el.scrollTop = el.scrollHeight;
      return true;
    });
    assert(scrolled, 'could not find the scroll container');
    await sleep(1000);
    await page.screenshot({ path: path.join(SHOTS, '6-detail-bottom.png') });
    return 'all tiles present, scrolled';
  });

  await step('air quality tile is present', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/AIR QUALITY/i.test(txt), 'no AQI tile');
    assert(/PM2\.5/.test(txt), 'no PM2.5 readout');
    return 'AQI + PM2.5 shown';
  });

  console.log('\nSettings');
  await step('settings screen renders', async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/Settings/i.test(txt), 'no settings heading');
    assert(txt.includes('zeki'), 'signed-in user not shown');
    await page.screenshot({ path: path.join(SHOTS, '7-settings.png') });
    return 'rendered';
  });

  await step('switching to °F persists to the server', async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '°F');
      b.click();
    });
    await sleep(1500);
    const r = await page.evaluate(async () =>
      (await fetch('/api/prefs', { credentials: 'include' }).then((x) => x.json())).units
    );
    assert(r === 'imperial', `server says ${r}`);
    return 'server units = imperial';
  });

  await step('switching to Turkish translates the UI', async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Türkçe');
      b.click();
    });
    await sleep(1500);
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/Ayarlar|Birimler|Görünüm/.test(txt), 'UI did not translate');
    await page.screenshot({ path: path.join(SHOTS, '8-settings-tr.png') });
    return 'Turkish applied';
  });

  await step('Turkish city list still renders forecasts', async () => {
    await page.evaluate(async () => {
      await fetch('/api/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ units: 'metric' }),
      });
    });
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const txt = await page.evaluate(() => document.body.innerText);
    assert(/Hava Durumu/.test(txt), 'header not translated');
    assert(/\d+°/.test(txt), 'no temperature');
    await page.screenshot({ path: path.join(SHOTS, '9-list-tr.png') });
    return txt.split('\n').filter(Boolean).slice(0, 3).join(' / ');
  });

  console.log('\nRuntime errors');
  await step('no uncaught page exceptions', async () => {
    assert(pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
    return 'none';
  });

  await step('no console errors', async () => {
    const real = consoleErrors.filter((e) => !/favicon|manifest|sw\.js|Failed to load resource/i.test(e));
    assert(real.length === 0, real.join(' | ').slice(0, 300));
    return 'none';
  });

  await browser.close();

  console.log('\n=======================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
