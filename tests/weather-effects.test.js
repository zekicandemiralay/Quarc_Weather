// Exercises WeatherEffects across every sky mood by intercepting the real
// /api/weather response and swapping in synthetic current.weather_code /
// is_day / temperature_2m — real weather right now is whatever it is, this
// is the only way to actually prove each of the 8 sky buckets renders the
// right particle layer (and only that layer).

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots-effects');
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

// [code, is_day, tempC, expectedSelectors, forbiddenSelectors, label]
const CASES = [
  [0, 1, 22, ['.weather-sun-glow'], ['.weather-star', '.weather-raindrop', '.weather-snowflake', '.weather-lightning'], 'clear day -> sun glow'],
  [0, 0, 15, ['.weather-star'], ['.weather-sun-glow', '.weather-raindrop', '.weather-snowflake'], 'clear night -> stars'],
  [0, 1, 34, ['.weather-sun-glow'], ['.weather-star'], 'hot clear day (34C) -> still sun glow (hot reuses clear)'],
  [2, 1, 20, ['.weather-cloud'], ['.weather-raindrop', '.weather-star'], 'partly cloudy -> drifting clouds'],
  [45, 1, 12, ['.weather-fog-band'], ['.weather-raindrop', '.weather-cloud'], 'fog -> fog bands'],
  [63, 1, 14, ['.weather-raindrop'], ['.weather-snowflake', '.weather-lightning', '.weather-star'], 'rain -> raindrops'],
  [73, 0, -2, ['.weather-snowflake'], ['.weather-raindrop', '.weather-star'], 'snow at night -> snowflakes only (no stars — snow bucket wins)'],
  [96, 1, 18, ['.weather-raindrop', '.weather-lightning'], ['.weather-snowflake', '.weather-sun-glow'], 'thunderstorm -> rain + lightning flash'],
];

(async () => {
  const fs = require('fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

  console.log('\nQuarc Weather — weather background effects\n===========================================\n');

  let template = null;
  const passThrough = (req) => req.continue();

  await step('login and reach a city with a real forecast (captures the response template)', async () => {
    await page.setRequestInterception(true);
    page.on('request', passThrough);

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

    const respPromise = page.waitForResponse((r) => r.url().includes('/api/weather?'), { timeout: 15000 });
    await page.click('ul > li button');
    const resp = await respPromise;
    template = await resp.json();
    await page.waitForFunction(() => window.location.pathname.startsWith('/city/'), { timeout: 15000 });
    await sleep(800);
    assert(template && template.current, 'no template captured');
    return `captured a real response (${template.current.temperature_2m}°C, code ${template.current.weather_code})`;
  });

  page.off('request', passThrough);

  for (const [code, isDay, temp, expect, forbid, label] of CASES) {
    await step(label, async () => {
      const handler = (req) => {
        if (req.url().includes('/api/weather?')) {
          const body = JSON.parse(JSON.stringify(template));
          body.current.weather_code = code;
          body.current.is_day = isDay;
          body.current.temperature_2m = temp;
          req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          });
        } else {
          req.continue();
        }
      };
      page.on('request', handler);
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(900);
      page.off('request', handler);

      for (const sel of expect) {
        const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
        assert(n > 0, `expected at least one ${sel}, found ${n}`);
      }
      for (const sel of forbid) {
        const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
        assert(n === 0, `expected no ${sel}, found ${n}`);
      }
      const shotName = label.split(' ')[0].replace(/[^a-z0-9]/gi, '') + '-' + code + '-' + isDay;
      await page.screenshot({ path: `${SHOTS}/${shotName}.png` });
      return `${expect.join(', ')} present; ${forbid.join(', ') || 'nothing forbidden'} absent`;
    });
  }

  await step('reduced motion is honored (animation-duration clamps to ~0)', async () => {
    await context.close();
    const ctx2 = await browser.createBrowserContext();
    const page2 = await ctx2.newPage();
    await page2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page2.setViewport({ width: 430, height: 932 });
    await page2.goto(BASE, { waitUntil: 'networkidle2' });
    await page2.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    await page2.type('input[placeholder="Username"]', USER);
    await page2.type('input[placeholder="Password"]', PASS);
    await Promise.all([
      page2.click('button[type="submit"]'),
      page2.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
    ]);
    await page2.waitForFunction(() => !!document.querySelector('ul > li'), { timeout: 15000 });
    await page2.click('ul > li button');
    await page2.waitForFunction(() => window.location.pathname.startsWith('/city/'), { timeout: 15000 });
    await sleep(500);
    const dur = await page2.evaluate(() => {
      const el = document.querySelector('.weather-sun-glow, .weather-raindrop, .weather-snowflake, .weather-star, .weather-cloud, .weather-fog-band');
      if (!el) return null;
      return getComputedStyle(el).animationDuration;
    });
    await ctx2.close();
    assert(dur !== null, 'no animated particle found to check');
    assert(/^0\.01ms/.test(dur) || parseFloat(dur) < 0.01, `expected ~0.01ms animation-duration under reduced motion, got ${dur}`);
    return `animation-duration clamped to ${dur} under prefers-reduced-motion`;
  });

  await browser.close();

  console.log('\n===========================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
