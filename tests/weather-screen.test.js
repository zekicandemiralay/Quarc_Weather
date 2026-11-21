// The city screen's data flow and the cards added to it, in a real browser
// against the real stack:
//   - opening a city is ONE /api/weather request (no city-list lookup first)
//   - the heads-up (alerts) card: wording, severity, ordering, language, absence
//   - the hourly strip places a sunrise/sunset that isn't "today's" (the bug
//     where evening users never saw tomorrow's sunrise)
//   - pull-to-refresh asks the server to refresh — and only from the top
//   - a cold open with NO network still renders the whole screen from the cache
//   - imperial users get miles, not "km" computed from feet
//   - the moon is mirrored in the southern hemisphere
//
// Alerts, sunrise times and so on are injected into the real response (real
// weather is whatever it is today), exactly like weather-effects.test.js.

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots-screen');
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

const pad = (n) => String(n).padStart(2, '0');
function addHours(iso, h) {
  const [d, t] = iso.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const x = new Date(Date.UTC(y, m - 1, dd, hh, mm) + h * 3600000);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}
function nowHourIn(tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:00`;
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // One interception handler for the whole run; each step sets `mutate` /
  // `abortApi` and the requests log, rather than stacking handlers.
  let template = null; // a real /api/weather?city= response, captured once
  let mutate = null; // (copyOfTemplate) => body, served for /api/weather?city= calls
  let abortApi = false; // fail every /api/* call (a real "no network")
  const requests = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/auth/')) {
      requests.push({ path: u.pathname, search: u.search });
      if (abortApi) return req.abort('failed');
    }
    if (mutate && template && u.pathname === '/api/weather' && u.searchParams.has('city')) {
      const body = mutate(JSON.parse(JSON.stringify(template)));
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return req.continue();
  });

  console.log('\nQuarc Weather — city screen\n===========================\n');

  let cityId;
  const weatherCalls = () => requests.filter((r) => r.path === '/api/weather' && /city=/.test(r.search));
  const text = () => page.evaluate(() => document.body.innerText);
  // "/" lands on the last-opened city (landing logic), so reaching the list
  // means going there and pressing the in-app back button — which is also how
  // a person gets there, and doesn't re-trigger the redirect.
  const openList = async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await page.waitForSelector('ul > li button, .sky h1', { timeout: 15000 });
    if (await page.$('.sky h1')) {
      await page.evaluate(() => Array.from(document.querySelectorAll('header button')).find((b) => b.innerText.includes('‹')).click());
    }
    await page.waitForSelector('ul > li button', { timeout: 15000 });
  };
  const openCity = async () => {
    await page.goto(`${BASE}/city/${cityId}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.sky h1', { timeout: 15000 });
    await sleep(400);
  };

  await step('login, reset state, save Istanbul and capture a real response', async () => {
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
      await fetch('/api/prefs', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', language: 'en', theme: 'dark' }),
      });
    });
    cityId = await page.evaluate(async () => {
      const r = await fetch('/api/cities', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Istanbul', country: 'Türkiye', latitude: 41.0138, longitude: 28.9497, timezone: 'Europe/Istanbul' }),
      });
      return (await r.json()).id;
    });
    assert(cityId, 'city not created');
    const resp = page.waitForResponse((r) => r.url().includes(`/api/weather?city=${cityId}`), { timeout: 20000 });
    await page.goto(`${BASE}/city/${cityId}`, { waitUntil: 'networkidle2' });
    template = await (await resp).json();
    assert(template.current && template.city?.id === cityId, 'template missing current/city');
    return `${template.city.name}, ${template.current.temperature_2m}°C`;
  });

  console.log('Loading');
  await step('opening a city from the list is one /api/weather request and no city-list lookup', async () => {
    await openList();
    requests.length = 0;
    await page.click('ul > li button');
    await page.waitForFunction(() => location.pathname.startsWith('/city/'), { timeout: 10000 });
    await page.waitForSelector('.sky h1', { timeout: 15000 });
    await sleep(600);
    const w = weatherCalls();
    const lists = requests.filter((r) => r.path === '/api/cities');
    assert(w.length === 1, `expected exactly 1 /api/weather?city= call, saw ${w.length}`);
    assert(lists.length === 0, `expected no /api/cities call, saw ${lists.length}`);
    return '1 weather call, 0 list calls';
  });

  await step('the footer says how fresh the data is', async () => {
    await openCity();
    const t = await text();
    assert(/Open-Meteo · Europe\/Istanbul · Updated/.test(t), `footer was: ${t.split('\n').slice(-3).join(' | ')}`);
    return 'Updated … shown';
  });

  console.log('\nHeads-up card');
  const today = () => template.daily.time[1];
  const tomorrow = () => template.daily.time[2];

  await step('injected alerts render with title, severity, window, detail and the "not official" disclaimer', async () => {
    mutate = (b) => ({
      ...b,
      alerts: [
        { type: 'thunderstorm', level: 2, start: `${today()}T14:00`, end: `${today()}T17:00`, ongoing: false },
        { type: 'strong_wind', level: 1, start: `${tomorrow()}T02:00`, end: `${tomorrow()}T06:00`, ongoing: false, value: 72, unit: 'km/h' },
        { type: 'heavy_rain', level: 1, start: `${today()}T08:00`, end: `${today()}T11:00`, ongoing: true, value: 6.5, unit: 'mm' },
      ],
    });
    await openCity();
    const card = await page.$('[data-testid="alerts-card"]');
    assert(card, 'alerts card not rendered');
    // textContent, not innerText: innerText applies the CSS uppercase on headings and badges.
    const t = await page.$eval('[data-testid="alerts-card"]', (el) => el.textContent);
    for (const want of ['Heads-up', 'Thunderstorms', 'Warning', '14:00 – 17:00', 'Strong wind', 'Tomorrow 02:00 – 06:00', 'Gusts up to 72 km/h', 'Heavy rain', 'Now – 11:00', 'Up to 6.5 mm/h', 'not official']) {
      assert(t.includes(want), `missing "${want}" in:\n${t}`);
    }
    const levels = await page.$$eval('[data-testid="alerts-card"] li', (els) => els.map((e) => e.dataset.level));
    assert(levels.join() === '2,1,1', `severity order was ${levels}`);
    await page.screenshot({ path: path.join(SHOTS, 'alerts-en.png') });
    return '3 alerts, warning first, wording correct';
  });

  await step('no alerts → no card at all (it must not render an empty box)', async () => {
    mutate = (b) => ({ ...b, alerts: [] });
    await openCity();
    assert(!(await page.$('[data-testid="alerts-card"]')), 'card rendered with zero alerts');
    return 'absent';
  });

  await step('the card is localised (Turkish)', async () => {
    const setLang = (language) =>
      page.evaluate(
        (l) => fetch('/api/prefs', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: l }) }),
        language
      );
    await setLang('tr');
    try {
      mutate = (b) => ({
        ...b,
        alerts: [{ type: 'thunderstorm', level: 2, start: `${tomorrow()}T01:00`, end: `${tomorrow()}T03:00`, ongoing: false }],
      });
      await openCity(); // a full page load re-reads the saved language
      await sleep(800);
      const t = await page.$eval('[data-testid="alerts-card"]', (el) => el.textContent);
      for (const want of ['Hava uyarıları', 'Gök gürültülü fırtına', 'Uyarı', 'Yarın 01:00 – 03:00', 'resmî']) {
        assert(t.includes(want), `missing "${want}" in:\n${t}`);
      }
      await page.screenshot({ path: path.join(SHOTS, 'alerts-tr.png') });
      return 'Turkish strings and "Yarın"';
    } finally {
      // Always restore — a failure above must not leave the account in Turkish for every later step.
      await setLang('en');
      mutate = null;
    }
  });

  console.log('\nHourly strip');
  await step("a sunrise that is NOT today's still lands in the strip", async () => {
    const tz = template.timezone;
    const target = addHours(nowHourIn(tz), 3).replace(/:00$/, ':30'); // 3½ hours from now — always inside the 24h window
    const hhmm = target.slice(11, 16);
    mutate = (b) => {
      const sunrise = b.daily.sunrise.slice();
      sunrise[1] = `${b.daily.time[1]}T00:10`; // today's: already past (or outside) — must not be the one that shows
      sunrise[2] = target; // "tomorrow's" slot: the old code never looked past index 1
      return { ...b, daily: { ...b.daily, sunrise }, alerts: [] };
    };
    await openCity();
    const cells = await page.$$eval('section', (secs) => {
      const s = secs.find((x) => /hourly forecast/i.test(x.textContent));
      return s ? Array.from(s.querySelectorAll('.flex-col')).map((c) => c.textContent.replace(/\s+/g, ' ')) : [];
    });
    assert(cells.some((c) => c.includes(hhmm) && /sunrise/i.test(c)), `no "${hhmm} Sunrise" cell. Cells: ${cells.slice(0, 12).join(' | ')}`);
    await page.screenshot({ path: path.join(SHOTS, 'hourly-sunrise.png') });
    return `"${hhmm} Sunrise" present`;
  });

  console.log('\nPull to refresh');
  const pull = (fromScrollTop) => page.evaluate(async (scrollTop) => {
    const el = document.querySelector('.sky.overflow-y-auto') || document.querySelector('.sky');
    el.scrollTop = scrollTop;
    const mk = (y) => new Touch({ identifier: 1, target: el, clientX: 215, clientY: y });
    const fire = (type, y) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)] }));
    fire('touchstart', 200);
    fire('touchmove', 300);
    fire('touchmove', 440);
    fire('touchend', 440);
    return el.scrollTop;
  }, fromScrollTop);

  await step('pulling down from the top asks the server for a forced refresh', async () => {
    mutate = null;
    await openCity();
    requests.length = 0;
    await pull(0);
    await sleep(1200);
    const forced = weatherCalls().filter((r) => /refresh=1/.test(r.search));
    assert(forced.length === 1, `expected 1 refresh=1 call, saw ${forced.length}`);
    return 'refresh=1 requested';
  });

  await step('a short pull does nothing', async () => {
    requests.length = 0;
    await page.evaluate(() => {
      const el = document.querySelector('.sky.overflow-y-auto') || document.querySelector('.sky');
      el.scrollTop = 0;
      const mk = (y) => new Touch({ identifier: 1, target: el, clientX: 215, clientY: y });
      const fire = (type, y) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)] }));
      fire('touchstart', 200); fire('touchmove', 230); fire('touchend', 230);
    });
    await sleep(600);
    assert(weatherCalls().length === 0, 'a 30px pull triggered a refresh');
    return 'no request';
  });

  await step('pulling while scrolled down (not at the top) does nothing', async () => {
    requests.length = 0;
    // Make sure there is something to scroll first.
    await page.evaluate(() => { document.querySelector('.sky.overflow-y-auto').scrollTop = 400; });
    const st = await pull(400);
    await sleep(600);
    assert(st > 0, 'page was not actually scrolled');
    assert(weatherCalls().length === 0, 'refresh fired while scrolled away from the top');
    return 'no request';
  });

  console.log('\nOffline');
  await step('a cold open with no network renders the whole screen from the cache, flagged as offline', async () => {
    mutate = null;
    await openCity(); // online, populates the cache
    await openList(); // a clean SPA state, away from the city page
    abortApi = true;
    // Client-side navigation straight to the city, as if opened from a cold start with no signal.
    await page.evaluate((id) => {
      history.pushState({}, '', `/city/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, cityId);
    await page.waitForSelector('.sky h1', { timeout: 10000 });
    const t = await text();
    abortApi = false;
    assert(/Istanbul/.test(t), 'city name missing offline');
    assert(/Offline — showing last known conditions/.test(t), 'offline banner missing');
    assert(/HOURLY FORECAST/i.test(t) && /10-DAY FORECAST/i.test(t), 'forecast cards missing offline');
    return 'Istanbul + forecast + offline banner';
  });

  await step('offline copies never show the heads-up card (it describes windows from when it was fetched)', async () => {
    mutate = (b) => ({ ...b, alerts: [{ type: 'thunderstorm', level: 2, start: `${today()}T14:00`, end: `${today()}T17:00`, ongoing: false }] });
    await openCity(); // online with an alert → cached
    assert(await page.$('[data-testid="alerts-card"]'), 'precondition: alert shown online');
    await openList();
    abortApi = true;
    await page.evaluate((id) => { history.pushState({}, '', `/city/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, cityId);
    await page.waitForSelector('.sky h1', { timeout: 10000 });
    const shown = !!(await page.$('[data-testid="alerts-card"]'));
    abortApi = false;
    mutate = null;
    assert(!shown, 'stale alert card shown from the offline cache');
    return 'hidden while offline';
  });

  console.log('\nUnits and hemisphere');
  // Open-Meteo reports visibility in FEET when the precipitation unit is inches
  // (and in metres otherwise — the temperature unit alone doesn't change it), so
  // "imperial" here means °F + inches. The tile must follow the unit the API
  // actually sent, not assume one.
  const setPrefs = (patch) =>
    page.evaluate(
      (p) => fetch('/api/prefs', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }),
      patch
    );
  const visibilityTile = () =>
    page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find((x) => /visibility/i.test(x.textContent));
      return h ? h.parentElement.textContent.replace(/\s+/g, ' ').trim() : null;
    });

  await step('inches (API reports feet): visibility is shown in miles, never "km" computed from feet', async () => {
    await setPrefs({ units: 'imperial', precip_unit: 'inch' });
    try {
      await openCity();
      await sleep(800);
      const tile = await visibilityTile();
      assert(tile, 'visibility tile not found');
      assert(/\d\s?mi(?![a-z])/.test(tile) && !/\d\s?km/i.test(tile), `tile was: ${tile}`);
      return tile;
    } finally {
      await setPrefs({ units: 'metric', precip_unit: 'mm' });
    }
  });

  await step('metric: visibility is shown in km', async () => {
    await openCity();
    await sleep(800);
    const tile = await visibilityTile();
    assert(tile && /\d\s?km/i.test(tile) && !/\d\s?mi(?![a-z])/.test(tile), `tile was: ${tile}`);
    return tile;
  });

  await step('the moon is mirrored for a southern-hemisphere city and not for a northern one', async () => {
    const mirrored = () => page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find((x) => /MOON/i.test(x.innerText));
      const svg = h?.parentElement.querySelector('svg');
      return svg ? svg.style.transform.includes('scaleX(-1)') : null;
    });
    await openCity();
    const north = await mirrored();
    const sydneyId = await page.evaluate(async () => {
      const r = await fetch('/api/cities', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sydney', country: 'Australia', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' }),
      });
      return (await r.json()).id;
    });
    await page.goto(`${BASE}/city/${sydneyId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.sky h1', { timeout: 15000 });
    const south = await mirrored();
    await page.evaluate((id) => fetch(`/api/cities/${id}`, { method: 'DELETE', credentials: 'include' }), sydneyId);
    assert(north === false, `Istanbul moon mirrored=${north}`);
    assert(south === true, `Sydney moon mirrored=${south}`);
    return 'Istanbul normal, Sydney mirrored';
  });

  console.log('\nRuntime errors');
  await step('no page exceptions', async () => {
    assert(pageErrors.length === 0, pageErrors.join(' | '));
    return 'none';
  });
  await step('no console errors (other than the deliberately aborted offline calls)', async () => {
    const real = consoleErrors.filter((e) => !/net::ERR_FAILED|Failed to load resource|Failed to fetch/i.test(e));
    assert(real.length === 0, real.slice(0, 3).join(' | '));
    return 'none';
  });

  await browser.close();
  console.log('\n===========================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
