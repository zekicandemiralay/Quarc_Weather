// The daily-briefing section of Settings, end to end: the toggle, the time picker, and that the choice is kept
// PER DEVICE — a phone wants a morning notification, a laptop does not — so it lives in the device's own storage
// and is never sent to the Quarc server or to the account's other devices (only units, wind, precipitation and
// language follow the account).
//
// The native side (NotificationBridgePlugin, DailyBriefingWorker) has no WebView here to test against —
// window.Capacitor simply doesn't exist in headless Chrome, so syncDailyBriefingSchedule() no-ops cleanly, which is
// itself worth confirming (no console errors from calling into a missing bridge).

const path = require('path');
const fs = require('fs');
const H = require('./helpers/app');

const SHOTS = path.join(__dirname, 'shots-briefing');

const stored = (d) => d.page.evaluate(() => JSON.parse(localStorage.getItem('quarc_weather_prefs') || '{}'));
const timeInput = (d) => d.page.evaluate(() => { const i = document.querySelector('input[type="time"]'); return i ? { value: i.value, disabled: i.disabled } : null; });
const clickBriefing = (d, which) =>
  d.page.evaluate((w) => {
    const row = [...document.querySelectorAll('span')].find((s) => s.textContent === 'Morning notification');
    row?.parentElement?.querySelector(w === 'on' ? 'button:last-child' : 'button:first-child')?.click();
  }, which);
/** A real in-app click on the gear, not a page.goto — a goto is a full reload that re-triggers the landing redirect. */
async function openSettings(d) {
  await d.page.waitForSelector('button[aria-label="Settings"]', { timeout: 20000 });
  await d.page.click('button[aria-label="Settings"]');
  // input[type="time"] rather than the translated section title — language-independent.
  await d.page.waitForSelector('input[type="time"]', { timeout: 20000 });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = H.createRunner('Quarc Weather — daily briefing settings (per device)');
  const browser = await H.launch();
  const phone = await H.freshSession(browser, { name: 'phone' });
  const { page } = phone;

  await t.step('open Settings and find the daily briefing section, off by default', async () => {
    await H.goList(phone);
    await openSettings(phone);
    const ti = await timeInput(phone);
    t.assert(ti, 'no time input found');
    t.assert(ti.disabled === true, 'expected the time input to start disabled (briefing off by default)');
    return 'section present, time picker disabled while off';
  });

  await t.step('turning the toggle on enables the time picker and is remembered on this device', async () => {
    await clickBriefing(phone, 'on');
    await H.sleep(600);
    const ti = await timeInput(phone);
    t.assert(ti && ti.disabled === false, 'expected the time picker to become enabled');
    const s = await stored(phone);
    t.assert(!!s.daily_briefing_enabled, `device storage says enabled=${s.daily_briefing_enabled}`);
    return 'enabled, stored on the device';
  });

  await t.step('changing the time picker is remembered (hour and minute)', async () => {
    const input = await page.$('input[type="time"]');
    await page.evaluate((el) => {
      // A plain `el.value = X` does not trigger React's onChange (React tracks the last value it saw); calling the
      // native, un-patched prototype setter makes the follow-up event register as a real change.
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(el, '19:15');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, input);
    await H.sleep(600);
    const s = await stored(phone);
    t.assert(s.daily_briefing_hour === 19 && s.daily_briefing_minute === 15, `device storage says ${s.daily_briefing_hour}:${s.daily_briefing_minute}`);
    return '19:15';
  });

  await t.step('a reload shows the saved state (it survives a restart, not just memory)', async () => {
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="time"]', { timeout: 20000 });
    await H.sleep(500);
    const ti = await timeInput(phone);
    t.assert(ti.value === '19:15' && ti.disabled === false, `after reload the picker reads ${ti.value}${ti.disabled ? ' (disabled)' : ''}`);
    await page.screenshot({ path: path.join(SHOTS, '1-briefing-enabled.png') });
    return `reads ${ti.value} after reload`;
  });

  await t.step('the schedule never reaches the server — it stays on this device', async () => {
    // Give the sync engine every chance to push, then look at what the account actually holds.
    await H.sleep(1500);
    const s = await H.serverState(phone.userId);
    t.assert(!/briefing/i.test(JSON.stringify(s.prefs)), `the account holds: ${JSON.stringify(s.prefs)}`);
    return 'not in the account';
  });

  await t.step("another device on the same account has its own, separate setting (still off)", async () => {
    const laptop = await H.newDevice(browser, { name: 'laptop' });
    await H.login(laptop);
    await H.goList(laptop);
    await openSettings(laptop);
    const ti = await timeInput(laptop);
    t.assert(ti && ti.disabled === true, 'the second device inherited the phone\'s briefing setting');
    t.assert(!(await stored(laptop)).daily_briefing_enabled, 'the second device stored the briefing as enabled');
    laptop.stray = [...laptop.pageErrors, ...laptop.errors];
    t.assert(laptop.stray.length === 0, laptop.stray.join('; '));
    await laptop.context.close();
    return 'laptop is off while the phone is on';
  });

  await t.step('turning the toggle back off disables the time picker', async () => {
    await clickBriefing(phone, 'off');
    await H.sleep(600);
    const ti = await timeInput(phone);
    t.assert(ti && ti.disabled === true, 'expected the time picker to become disabled again');
    t.assert(!(await stored(phone)).daily_briefing_enabled, 'device storage still says enabled');
    return 'disabled and stored off';
  });

  await t.step('no console errors from a missing native bridge (web has no window.Capacitor)', async () => {
    const all = [...phone.pageErrors, ...phone.errors];
    t.assert(all.length === 0, `console errors: ${all.join('; ')}`);
    return 'clean';
  });

  await browser.close();
  t.finish(`screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
