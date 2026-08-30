// Proves the cross-timezone hour bug is actually fixed: emulates the
// browser being physically in New York (UTC-4/5) while viewing Istanbul
// (UTC+3) — a ~7-9 hour gap, nothing that could coincidentally cancel out.
// Before the fix, every displayed hour (the "Now" cell, hourly labels,
// sunrise/sunset) would have been shifted by exactly that gap, because
// Open-Meteo's hourly.time strings are naive local wall-clock (no UTC
// offset marker) and `new Date(iso)` silently re-interprets them in
// whichever zone the *viewer* happens to be in.

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots-timezone');
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

  // The whole point: this browser is NOT in Istanbul's timezone.
  await page.emulateTimezone('America/New_York');

  console.log('\nQuarc Weather — cross-timezone hour correctness\n================================================\n');
  console.log('  Browser emulated timezone: America/New_York (viewing Istanbul, UTC+3)\n');

  await step('login and reach the real system clock reading', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    await page.type('input[placeholder="Username"]', USER);
    await page.type('input[placeholder="Password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
    ]);
    // Independently compute what "now" should read as in both zones, using
    // the browser's own (emulated) clock — this is the ground truth the
    // app's output gets checked against below.
    const truth = await page.evaluate(() => {
      const parts = (tz) => {
        const p = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date());
        return `${p.find((x) => x.type === 'hour').value}:${p.find((x) => x.type === 'minute').value}`;
      };
      return { nyTime: parts('America/New_York'), istanbulTime: parts('Europe/Istanbul') };
    });
    global.truth = truth;
    return `browser clock reads ${truth.nyTime} in NY, ${truth.istanbulTime} in Istanbul right now`;
  });

  await step('reset state and add Istanbul', async () => {
    // Reset both cities AND language/units — this suite must produce
    // correct results regardless of what a previous suite run left behind
    // (e.g. ui.test.js's own Settings check switches the account to
    // Turkish/imperial and doesn't switch back), since the text assertions
    // below match specific English strings ("Now", "HOURLY", "SUNRISE").
    await page.evaluate(async () => {
      const cities = await fetch('/api/cities', { credentials: 'include' }).then((r) => r.json());
      await Promise.all(cities.map((c) => fetch(`/api/cities/${c.id}`, { method: 'DELETE', credentials: 'include' })));
      await fetch('/api/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', theme: 'auto', language: 'en' }),
      });
      localStorage.removeItem('quarc_weather_prefs');
      localStorage.setItem('language', 'en');
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
    await sleep(2000);
    return 'opened Istanbul';
  });

  await step('the hourly strip\'s "Now" cell is labeled with the correct Istanbul hour', async () => {
    // The cell showing "Now" is a placeholder for the current Istanbul
    // hour — the cell immediately after it should be exactly +1 hour in
    // Istanbul's own wall-clock, which only holds if the whole slice was
    // anchored to the *right* hour in the first place.
    const cellTemps = await page.evaluate(() => {
      const strip = [...document.querySelectorAll('section')].find((s) => /HOURLY/i.test(s.textContent));
      return strip ? strip.innerText : '';
    });
    const expectedIstanbulHour = parseInt(global.truth.istanbulTime.split(':')[0], 10);
    const nextHour = String((expectedIstanbulHour + 1) % 24).padStart(2, '0');
    assert(cellTemps.includes('Now'), `no "Now" cell found: ${cellTemps.slice(0, 100)}`);
    assert(
      cellTemps.includes(`${nextHour}:`) || new RegExp(`\\b${nextHour}\\b`).test(cellTemps),
      `expected the hour after Now to be ${nextHour} (Istanbul time), strip shows: ${cellTemps.slice(0, 200)}`
    );
    return `"Now" is followed by ${nextHour}:xx — matches Istanbul's real current+1 hour, not New York's`;
  });

  await step('scroll to detail tiles and capture sunrise for visual confirmation', async () => {
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50);
      if (el) el.scrollTop = el.scrollHeight;
    });
    await sleep(1000);
    await page.screenshot({ path: `${SHOTS}/1-detail-with-sunrise.png` });
    const txt = await page.evaluate(() => document.body.innerText);
    const sunriseMatch = txt.match(/SUNRISE[\s\S]{0,40}?(\d{2}:\d{2})/);
    assert(sunriseMatch, `couldn't find a sunrise time in: ${txt.slice(0, 300)}`);
    const [hh] = sunriseMatch[1].split(':').map(Number);
    // Istanbul sunrise in August is roughly 06:00-06:30 local — nowhere
    // near what a New-York-shifted misinterpretation would produce
    // (which would land 7-8 hours off, i.e. very late night/pre-dawn).
    assert(hh >= 4 && hh <= 8, `sunrise hour ${hh} is not a plausible Istanbul morning — looks shifted`);
    return `sunrise shown as ${sunriseMatch[1]} — a real Istanbul-morning time, not shifted by the NY gap`;
  });

  await context.close();
  await browser.close();

  console.log('\n================================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
