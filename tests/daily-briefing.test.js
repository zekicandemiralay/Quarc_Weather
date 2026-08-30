// Exercises the daily briefing Settings UI end to end: toggle on/off, time
// picker, and that both actually persist to the server. The native side
// (NotificationBridgePlugin, DailyBriefingWorker) has no WebView here to
// test against — window.Capacitor simply doesn't exist in headless Chrome,
// so syncDailyBriefingSchedule() no-ops cleanly, which is itself worth
// confirming (no console errors from calling into a missing bridge).

const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const SHOTS = path.join(__dirname, 'shots-briefing');
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

  const consoleErrors = [];
  page.on('console', (msg) => {
    // Chrome surfaces failed-resource-load network errors through the same
    // console channel as real console.error() calls, with no URL attached —
    // the response listener below tracks 401s specifically, with the URL,
    // and already excludes the one expected case (pre-login session check).
    // Without this filter here too, that same expected 401 would still
    // trip this listener a second time with no way to tell it apart.
    if (msg.type() === 'error' && !/status of 401/.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('response', (res) => {
    // A 401 on /api/auth/me before login is expected, by-design behavior —
    // that's literally how the app knows to show the login screen, not a
    // bug. Only flag 401s that happen anywhere else.
    if (res.status() === 401 && !res.url().includes('/api/auth/me')) consoleErrors.push(`401 on ${res.url()}`);
  });

  console.log('\nQuarc Weather — daily briefing settings\n========================================\n');

  await step('login and reset prefs to defaults', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    await page.type('input[placeholder="Username"]', USER);
    await page.type('input[placeholder="Password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
    ]);
    // Also reset language/units — ui.test.js's own Settings check
    // deliberately leaves the account in Turkish/imperial when it finishes,
    // and this suite's selectors match English text/aria-labels.
    await page.evaluate(async () => {
      await fetch('/api/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          daily_briefing_enabled: false, daily_briefing_hour: 8, daily_briefing_minute: 0,
          units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', theme: 'auto', language: 'en',
        }),
      });
      localStorage.removeItem('quarc_weather_prefs');
      localStorage.setItem('language', 'en');
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);
    return 'authenticated, prefs reset to English/metric';
  });

  await step('open Settings and find the daily briefing section', async () => {
    // A real in-app click, not page.goto('/settings') — a goto is a full
    // reload, which re-triggers the current-location landing redirect and
    // bounces straight past Settings before it ever renders (the same test
    // mistake already fixed once this session in a different suite).
    // 20s, not 10s — the landing page has an 8-second geolocation guard
    // timer (getCurrentPositionSafe) it must clear before it even settles
    // on a final page to render, on top of whatever comes after that.
    await page.waitForSelector('button[aria-label="Settings"]', { timeout: 20000 });
    await page.click('button[aria-label="Settings"]');
    // input[type="time"] rather than matching the translated section title —
    // language-independent, so this can't race against i18n settling after
    // the reload in the step above.
    await page.waitForSelector('input[type="time"]', { timeout: 20000 });
    const timeInput = await page.$('input[type="time"]');
    assert(timeInput, 'no time input found');
    const disabled = await page.evaluate((el) => el.disabled, timeInput);
    assert(disabled === true, 'expected the time input to start disabled (briefing off by default)');
    return 'section present, time input correctly disabled while off';
  });

  await step('turning the toggle on enables the time picker and persists to the server', async () => {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('span')].find((s) => s.textContent === 'Morning notification');
      const onBtn = row?.parentElement?.querySelector('button:last-child');
      onBtn?.click();
    });
    await sleep(600);
    const enabled = await page.evaluate(() => {
      const input = document.querySelector('input[type="time"]');
      return input ? !input.disabled : null;
    });
    assert(enabled === true, 'expected time input to become enabled');

    const serverState = await page.evaluate(() => fetch('/api/prefs', { credentials: 'include' }).then((r) => r.json()));
    assert(serverState.daily_briefing_enabled === 1, `expected server-side enabled=1, got ${serverState.daily_briefing_enabled}`);
    return `server confirms enabled=${serverState.daily_briefing_enabled}`;
  });

  await step('changing the time picker persists the new hour/minute to the server', async () => {
    const input = await page.$('input[type="time"]');
    await page.evaluate((el) => {
      // A plain `el.value = X` does NOT trigger React's onChange — React
      // patches the DOM property's setter to track "last known value" as
      // part of ANY assignment, so by the time the subsequent 'input' event
      // fires, React sees no difference from what it already recorded and
      // skips the handler. The standard workaround: call the native
      // (un-patched) prototype setter directly, bypassing React's tracker,
      // so the follow-up event is correctly seen as a real change.
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(el, '19:15');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, input);
    await sleep(600);

    const serverState = await page.evaluate(() => fetch('/api/prefs', { credentials: 'include' }).then((r) => r.json()));
    assert(serverState.daily_briefing_hour === 19 && serverState.daily_briefing_minute === 15,
      `expected 19:15, got ${serverState.daily_briefing_hour}:${serverState.daily_briefing_minute}`);
    return `server confirms ${serverState.daily_briefing_hour}:${serverState.daily_briefing_minute}`;
  });

  await step('a reload shows the persisted state (survives navigation, not just in-memory)', async () => {
    // page.reload() reloads AT THE CURRENT URL (/settings) — Settings.jsx's
    // own header has no gear icon (there's nothing to navigate to from
    // Settings but Settings), so unlike other reload-then-click flows in
    // this suite, there's no button to click here at all; just wait for the
    // page to re-render itself.
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="time"]', { timeout: 20000 });
    await sleep(500);
    const value = await page.evaluate(() => document.querySelector('input[type="time"]')?.value);
    assert(value === '19:15', `expected time input to read 19:15 after reload, got ${value}`);
    await page.screenshot({ path: `${SHOTS}/1-briefing-enabled.png` });
    return `time input reads ${value} after reload`;
  });

  await step('turning the toggle back off disables the time picker and persists', async () => {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('span')].find((s) => s.textContent === 'Morning notification');
      const offBtn = row?.parentElement?.querySelector('button:first-child');
      offBtn?.click();
    });
    await sleep(600);
    const disabled = await page.evaluate(() => document.querySelector('input[type="time"]')?.disabled);
    assert(disabled === true, 'expected time input to become disabled again');
    const serverState = await page.evaluate(() => fetch('/api/prefs', { credentials: 'include' }).then((r) => r.json()));
    assert(serverState.daily_briefing_enabled === 0, `expected server-side enabled=0, got ${serverState.daily_briefing_enabled}`);
    return `server confirms enabled=${serverState.daily_briefing_enabled}`;
  });

  await step('no console errors from a missing native bridge (web has no window.Capacitor)', async () => {
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('; ')}`);
    return 'clean';
  });

  await browser.close();

  console.log('\n========================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
