// The "Home screen widget" section of Settings — the in-app door to the native
// widget settings screen. There is no Android WebView here, so (like
// update-banner.test.js) a fake window.Capacitor is injected BEFORE the app
// loads: getPlatform() then reports 'android', and a fake WidgetBridge plugin
// records every call the app makes into the native side.
//
// What is proven here is the web half of the contract:
//   - the section exists only on Android (never on the plain web app)
//   - it offers "Customize" only when a widget is actually placed, and "Add"
//     either way (relabelled "Add another" once one exists)
//   - the buttons make exactly the native calls they should
//   - a launcher that can't add widgets gets told how to do it by hand
//   - it picks up a newly added widget without leaving the page
// The native screen itself (WidgetConfigActivity) can't run here; it is covered
// by the Gradle build + WidgetLogicTest (see tests/README.md).

const puppeteer = require('puppeteer');
const path = require('path');
const H = require('./helpers/app');

const BASE = H.BASE;
const SHOTS = path.join(__dirname, 'shots-widget-settings');
const USER = H.USER;
const PASS = H.PASS;

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

  const errors = [];
  const watch = (page) => {
    page.on('console', (m) => {
      // "Failed to load resource" carries no URL, so network failures are judged by URL below.
      if (m.type() === 'error' && !/status of 401|Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    // The native app's update gate asks Quarc Store (:4006), which isn't part of this local stack —
    // expected and unrelated. Any OTHER failed request is a real problem.
    page.on('requestfailed', (r) => {
      if (!r.url().includes('127.0.0.1:4006')) errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
    });
  };

  console.log('\nQuarc Weather — widget settings (Settings page)\n===============================================\n');

  // ---------------------------------------------------------------- plain web
  const webCtx = await browser.createBrowserContext();
  const web = await webCtx.newPage();
  await web.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  watch(web);

  const login = async (page) => {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    await page.type('input[placeholder="Username"]', USER);
    await page.type('input[placeholder="Password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.body.innerText.includes('Sign in to your Quarc account'), { timeout: 20000 }),
    ]);
  };
  const openSettings = async (page) => {
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('h1', { timeout: 15000 }); // the page title — present in every language
    await sleep(500);
  };
  // The language is a synced setting; change it the way a person does, with the buttons on the Settings screen.
  // (The buttons carry each language's own name, so this works whichever language the screen is in.)
  const setLang = async (page, language) => {
    await openSettings(page);
    const label = language === 'tr' ? 'Türkçe' : 'English';
    await page.evaluate((l) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === l).click(), label);
    await sleep(500);
  };
  const text = (page) => page.evaluate(() => document.body.textContent);

  await step('login on the plain web app and reset the language', async () => {
    await login(web);
    // Earlier suites may have left the account in another language, and this one matches English text.
    await H.resetAccount(await H.currentUserId({ page: web }));
    await setLang(web, 'en');
    return 'authenticated';
  });

  await step('the plain web app has no widget section (it is an Android feature)', async () => {
    await openSettings(web);
    const t = await text(web);
    assert(!t.includes('Home screen widget'), 'widget section shown on the web');
    assert(!(await web.$('[data-testid="widget-add"]')), 'add button shown on the web');
    return 'absent';
  });
  await webCtx.close();

  // ------------------------------------------------------------ fake Android
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 430, height: 1400, deviceScaleFactor: 2 });
  watch(page);
  await ctx.overridePermissions(BASE, []);

  await page.evaluateOnNewDocument(() => {
    window.__calls = [];
    // evaluateOnNewDocument re-runs on EVERY navigation, so the fake native state lives in
    // localStorage (which survives them) — a plain variable here would reset to 0 widgets
    // each time the test loads a page.
    const read = () => {
      try { return { count: 0, pinSupported: true, ...JSON.parse(localStorage.getItem('__fake') || '{}') }; }
      catch { return { count: 0, pinSupported: true }; }
    };
    Object.defineProperty(window, '__fake', { get: read });
    const record = (name, args) => window.__calls.push({ name, args });
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { getInfo: async () => ({ version: '1.0.9' }) },
        Geolocation: {
          // Denied unless a test stores a position in localStorage('__geo') first.
          requestPermissions: async () => ({ location: localStorage.getItem('__geo') ? 'granted' : 'denied' }),
          getCurrentPosition: async () => {
            const g = localStorage.getItem('__geo');
            if (!g) throw new Error('denied');
            return { coords: JSON.parse(g) };
          },
        },
        Updater: { downloadUpdate: () => {} },
        NotificationBridge: { setDailyBriefing: async (a) => { record('setDailyBriefing', a); } },
        WidgetBridge: {
          // What the app hands the native widget: its places and the unit (see lib/widgetPlaces.js).
          syncCities: async (a) => { record('syncCities', a); },
          clearCities: async () => { record('clearCities'); },
          offerPin: async () => {},
          widgetCount: async () => { record('widgetCount'); return { count: window.__fake.count }; },
          openSettings: async () => { record('openSettings'); },
          requestPin: async () => { record('requestPin'); return { supported: window.__fake.pinSupported }; },
        },
      },
    };
  });

  const calls = (name) => page.evaluate((n) => window.__calls.filter((c) => c.name === n).length, name);
  const fake = (patch) =>
    page.evaluate((p) => {
      localStorage.setItem('__fake', JSON.stringify({ ...window.__fake, ...p }));
    }, patch);
  const reset = () => page.evaluate(() => { window.__calls.length = 0; });

  await step('login inside the fake Android app', async () => {
    await login(page);
    return 'authenticated';
  });

  // ------------------------------------------------ what the app hands the native widget
  // The widget and the morning briefing fetch their own weather from the provider, so the app only has to tell
  // them WHICH places (saved cities, plus My Location when this device has a fix) and the unit.
  console.log('Feeding the widget');
  const pushes = () => page.evaluate(() => window.__calls.filter((c) => c.name === 'syncCities').map((c) => c.args));
  const waitForPush = (check, what) =>
    page.waitForFunction(
      (src) => window.__calls.some((c) => c.name === 'syncCities' && new Function('a', `return (${src})(a)`)(c.args)),
      { timeout: 10000 },
      check.toString()
    ).catch(async () => { throw new Error(`no hand-over matching "${what}"; saw ${JSON.stringify(await pushes()).slice(0, 300)}`); });

  await step('a saved city is handed to the widget, with its coordinates and the temperature unit', async () => {
    await H.goList({ page });
    await H.addCityByName({ page }, 'Berlin', 'Berlin');
    await waitForPush((a) => a.cities.some((c) => c.name === 'Berlin'), 'Berlin in the list');
    const last = (await pushes()).filter((a) => a.cities.some((c) => c.name === 'Berlin')).pop();
    const berlin = last.cities.find((c) => c.name === 'Berlin');
    assert(/^c_/.test(berlin.id), `id was ${berlin.id}`);
    assert(berlin.isPin === false, 'a saved city was flagged as My Location');
    assert(Math.abs(berlin.latitude - 52.5) < 1 && Math.abs(berlin.longitude - 13.4) < 1, `coordinates ${berlin.latitude},${berlin.longitude}`);
    assert(last.units === 'metric', `units were ${last.units}`);
    assert(!last.cities.some((c) => c.isPin), 'a My Location entry appeared although location is denied');
    return `Berlin ${berlin.latitude.toFixed(2)},${berlin.longitude.toFixed(2)} · metric`;
  });

  await step('changing the temperature unit hands the widget the new unit', async () => {
    await page.click('button[aria-label="Settings"]');
    await page.waitForFunction(() => location.pathname === '/settings', { timeout: 10000 });
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '°F').click());
    await waitForPush((a) => a.units === 'imperial', 'units imperial');
    // Clear the log first: an older metric hand-over from the step above would satisfy the wait instantly.
    await reset();
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '°C').click());
    await waitForPush((a) => a.units === 'metric', 'units back to metric');
    return 'imperial, then metric';
  });

  await step('a burst of edits is not a burst of hand-overs (a quiet period collapses them)', async () => {
    await reset();
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '°F').click());
      await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '°C').click());
    }
    await sleep(2500);
    const seen = await pushes();
    // The burst ends exactly where it started, which the native side already has — so nothing at all is sent.
    assert(seen.length === 0, `${seen.length} hand-overs for a burst that ended where it started: ${JSON.stringify(seen[0] || null).slice(0, 200)}`);
    return 'none';
  });

  await step("this device's My Location is handed over FIRST, rounded, and flagged as the pin", async () => {
    await page.evaluate(() => localStorage.setItem('__geo', JSON.stringify({ latitude: 41.0082123, longitude: 28.9784456 })));
    try {
      await page.goto(BASE, { waitUntil: 'networkidle2' }); // a cold start takes a GPS fix and lands on My Location
      await waitForPush((a) => a.cities.some((c) => c.isPin), 'a My Location entry');
      const last = (await pushes()).filter((a) => a.cities.some((c) => c.isPin)).pop();
      const pin = last.cities[0];
      assert(pin.isPin === true && pin.id === 'here', `first entry was ${JSON.stringify(pin)}`);
      assert(pin.latitude === 41.008 && pin.longitude === 28.978, `not rounded to ~100 m: ${pin.latitude},${pin.longitude}`);
      assert(pin.name && pin.name.length > 0, 'My Location has no name');
      assert(last.cities.some((c) => c.name === 'Berlin' && !c.isPin), 'the saved city is missing next to My Location');
      return `${pin.name} (${pin.latitude}, ${pin.longitude}) then Berlin`;
    } finally {
      await page.evaluate(() => localStorage.removeItem('__geo')); // later steps run as a device without a fix
    }
  });

  console.log('Android, no widget placed yet');
  await step('the section appears, says there is no widget, and offers only "Add"', async () => {
    await fake({ count: 0 });
    await openSettings(page);
    const t = await text(page);
    assert(t.includes('Home screen widget'), 'section heading missing');
    assert(t.includes('There is no widget on your home screen yet'), 'empty-state text missing');
    assert(!(await page.$('[data-testid="widget-customize"]')), 'Customize offered with nothing to customize');
    const add = await page.$eval('[data-testid="widget-add"]', (e) => e.textContent.trim());
    assert(add === 'Add widget to home screen', `add label was "${add}"`);
    assert((await calls('widgetCount')) >= 1, 'the app never asked the native side how many widgets exist');
    await page.screenshot({ path: path.join(SHOTS, 'no-widget.png') });
    return 'Add only';
  });

  await step('"Add" asks the launcher to pin the widget (and shows no warning when it accepts)', async () => {
    await reset();
    await fake({ pinSupported: true });
    await page.click('[data-testid="widget-add"]');
    await sleep(400);
    assert((await calls('requestPin')) === 1, `requestPin called ${await calls('requestPin')}×`);
    assert(!(await text(page)).includes("can't add it for you"), 'warned although the launcher accepted');
    return '1 requestPin, no warning';
  });

  await step('a launcher that cannot pin widgets is told how to add it by hand', async () => {
    await reset();
    await fake({ pinSupported: false });
    await page.click('[data-testid="widget-add"]');
    await sleep(400);
    const t = await text(page);
    assert(t.includes("Your launcher can't add it for you"), 'manual instructions missing');
    assert(t.includes('open Widgets and choose Quarc Weather'), 'instructions incomplete');
    await page.screenshot({ path: path.join(SHOTS, 'manual-add.png') });
    return 'manual instructions shown';
  });

  console.log('\nAndroid, widget(s) placed');
  await step('with a widget placed: "Customize" appears and "Add" becomes "Add another"', async () => {
    await fake({ count: 2, pinSupported: true });
    await openSettings(page);
    assert(await page.$('[data-testid="widget-customize"]'), 'Customize missing');
    const add = await page.$eval('[data-testid="widget-add"]', (e) => e.textContent.trim());
    assert(add === 'Add another widget', `add label was "${add}"`);
    assert(!(await text(page)).includes('There is no widget on your home screen yet'), 'empty-state text still shown');
    await page.screenshot({ path: path.join(SHOTS, 'with-widget.png') });
    return 'Customize + Add another';
  });

  await step('"Customize" opens the native settings screen exactly once', async () => {
    await reset();
    await page.click('[data-testid="widget-customize"]');
    await sleep(300);
    assert((await calls('openSettings')) === 1, `openSettings called ${await calls('openSettings')}×`);
    assert((await calls('requestPin')) === 0, 'Customize must not try to add a widget');
    return '1 openSettings';
  });

  await step('adding a widget while on this page shows "Customize" without leaving it', async () => {
    await fake({ count: 0 });
    await openSettings(page);
    assert(!(await page.$('[data-testid="widget-customize"]')), 'precondition: no Customize yet');
    // The user went to the launcher, accepted the pin prompt, and came back to the app:
    await fake({ count: 1 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('[data-testid="widget-customize"]', { timeout: 5000 });
    return 'Customize appeared on return';
  });

  console.log('\nLanguage');
  await step('the section is available in Turkish', async () => {
    await setLang(page, 'tr');
    try {
      await fake({ count: 1 });
      await openSettings(page);
      await sleep(600);
      const t = await text(page);
      for (const want of ["Ana ekran widget'ı", "Widget'ı özelleştir", 'Başka bir widget ekle']) {
        assert(t.includes(want), `missing "${want}"`);
      }
      await page.screenshot({ path: path.join(SHOTS, 'turkish.png') });
      return 'Turkish strings';
    } finally {
      await setLang(page, 'en');
      // Never leave the account in Turkish for the next suite. The in-app change may not have synced yet when this
      // browser closes, so put the account itself back too.
      await H.resetAccount(await H.currentUserId({ page }));
    }
  });

  console.log('\nSigning out');
  await step('signing out clears the widget (it must not keep showing this person\'s cities)', async () => {
    await openSettings(page);
    await reset();
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Log out').click());
    await page.waitForFunction(() => window.__calls.some((c) => c.name === 'clearCities'), { timeout: 10000 });
    return 'clearCities called';
  });

  console.log('\nRuntime errors');
  await step('no console errors or exceptions', async () => {
    assert(errors.length === 0, errors.slice(0, 3).join(' | '));
    return 'none';
  });

  await browser.close();
  console.log('\n===============================================');
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  screenshots: ${SHOTS}\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
