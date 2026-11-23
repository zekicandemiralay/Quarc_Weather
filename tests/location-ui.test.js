// The app's landing behaviour end to end, with mocked GPS: My Location first, falling back to the last-opened city,
// falling back to the plain list — and now also with the Quarc server UNREACHABLE (Tailscale off), where the answer
// has to come from the device's own data. (The old app asked the server whether the last city still existed, so a cold
// start without the server fell through to a list that could not load.)

const path = require('path');
const fs = require('fs');
const H = require('./helpers/app');

const SHOTS = path.join(__dirname, 'shots-location');
const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 };

const pathname = (d) => d.page.evaluate(() => location.pathname);
async function waitPath(d, re, timeout = 25000) {
  await d.page.waitForFunction((src) => new RegExp(src).test(location.pathname), { timeout }, re.source);
}
/** Cold start: a full page load, then wait for the landing decision to settle. */
async function coldStart(d) {
  await d.page.goto(H.BASE, { waitUntil: 'networkidle2' });
  await H.sleep(2500); // the redirect decision awaits a GPS fix (up to 8 s) — give it room
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = H.createRunner('Quarc Weather — landing behaviour (My Location → last city → list)');
  const browser = await H.launch();

  // ---------------------------------------------------------------- a device that HAS location
  const gps = await H.freshSession(browser, { name: 'gps-phone', geo: ISTANBUL });
  t.section('Location granted');

  await t.step('the app lands on My Location with a real resolved place name, not raw coordinates', async () => {
    await H.goList(gps).catch(() => {}); // (may or may not redirect first — just settle)
    await coldStart(gps);
    await waitPath(gps, /^\/city\/here$/);
    await gps.page.waitForSelector('.sky h1', { timeout: 20000 });
    const name = await gps.page.$eval('.sky h1', (h) => h.textContent.trim());
    t.assert(!/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(name), `showing raw coordinates: ${name}`);
    t.assert(/Cankurtaran|Fatih|Istanbul|İstanbul|Sultanahmet/i.test(name), `no recognizable Istanbul-area name: ${name}`);
    await gps.page.screenshot({ path: path.join(SHOTS, '1-landing-my-location.png') });
    return name;
  });

  await t.step('the in-app back button shows My Location pinned first, with no reorder or delete controls', async () => {
    await gps.page.evaluate(() => Array.from(document.querySelectorAll('header button')).find((b) => b.innerText.includes('‹')).click());
    await gps.page.waitForSelector('button[aria-label="Add city"]', { timeout: 15000 });
    const first = await gps.page.$eval('ul > li', (li) => ({
      text: li.textContent,
      arrows: li.querySelectorAll('button[aria-label="Move up"], button[aria-label="Move down"]').length,
      remove: li.querySelectorAll('button[aria-label="Delete"]').length,
    }));
    t.assert(first.text.includes('📍'), `first card has no pin marker: ${first.text.slice(0, 50)}`);
    t.assert(first.arrows === 0 && first.remove === 0, `My Location offers ${first.arrows} arrows / ${first.remove} delete`);
    return 'pinned first, read-only';
  });

  await t.step('staying on the list via in-app navigation does NOT re-redirect (a reload does)', async () => {
    await gps.page.click('button[aria-label="Settings"]');
    await waitPath(gps, /^\/settings$/, 10000);
    await gps.page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('‹')).click());
    await H.sleep(2500);
    t.assert((await pathname(gps)) === '/', `after in-app navigation the path is ${await pathname(gps)}`);
    await coldStart(gps);
    await waitPath(gps, /^\/city\/here$/);
    return 'back stays on the list; reload lands on My Location';
  });

  await t.step('My Location never reaches the server — only manually added cities sync', async () => {
    await H.goList(gps);
    await H.addCityByName(gps, 'Berlin', 'Berlin');
    const s = await H.waitServer(gps.userId, (x) => x.cities.includes('Berlin'), 'Berlin');
    t.assert(s.cities.join() === 'Berlin', `server list: ${s.cities.join()}`);
    t.assert(!s.all.some((c) => /Cankurtaran|Fatih|Istanbul|İstanbul/i.test(c.name) && !c.is_deleted), 'a live-location pin reached the server');
    return 'server holds only Berlin';
  });

  await t.step('with the server UNREACHABLE and location available, the app still lands on My Location', async () => {
    gps.blocked = true;
    await coldStart(gps);
    await waitPath(gps, /^\/city\/here$/);
    await gps.page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
    gps.blocked = false;
    return 'GPS + provider need no server';
  });

  // ---------------------------------------------------------------- a device WITHOUT location
  t.section('Location denied');
  const dn = await H.newDevice(browser, { name: 'no-gps-phone', geo: null });
  let berlinPath;

  await t.step('nothing opened yet → the plain list (no redirect)', async () => {
    await H.login(dn);
    await H.sleep(2500);
    t.assert((await pathname(dn)) === '/', `landed on ${await pathname(dn)}`);
    await dn.page.waitForSelector('button[aria-label="Add city"]', { timeout: 10000 });
    await H.waitCards(dn, { has: ['Berlin'] }); // downloaded from the account on first sync
    return 'list';
  });

  await t.step('the last-opened city is where the app lands next time', async () => {
    await H.cardButton(dn, 'Berlin');
    await waitPath(dn, /^\/city\/c_/, 10000);
    berlinPath = await pathname(dn);
    await dn.page.waitForSelector('.sky h1', { timeout: 20000 });
    await coldStart(dn);
    await waitPath(dn, /^\/city\/c_/);
    t.assert((await pathname(dn)) === berlinPath, `landed on ${await pathname(dn)}, expected ${berlinPath}`);
    await dn.page.screenshot({ path: path.join(SHOTS, '2-landing-last-city.png') });
    return 'Berlin';
  });

  await t.step('with the server UNREACHABLE the last-opened city is still found — from the device, not the server', async () => {
    dn.blocked = true;
    await coldStart(dn);
    await waitPath(dn, /^\/city\/c_/);
    t.assert((await pathname(dn)) === berlinPath, `landed on ${await pathname(dn)}`);
    await dn.page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
    const onLogin = await dn.page.evaluate(() => !!document.querySelector('input[placeholder="Username"]'));
    t.assert(!onLogin, 'bounced to the login screen');
    dn.blocked = false;
    return 'cold start without the server → Berlin';
  });

  await t.step('no live-location pin is created when location is denied', async () => {
    const s = await H.serverState(dn.userId = await H.currentUserId(dn));
    t.assert(!s.all.some((c) => /Cankurtaran|Fatih|Istanbul/i.test(c.name) && !c.is_deleted), 'a pin exists');
    return 'confirmed';
  });

  await t.step('if the last-opened city was deleted, the app falls back to the list', async () => {
    await H.goList(dn).catch(() => {});
    await H.waitCards(dn, { has: ['Berlin'] });
    dn.page.once('dialog', (dlg) => dlg.accept());
    await H.cardButton(dn, 'Berlin', 'button[aria-label="Delete"]');
    await H.sleep(800);
    await coldStart(dn);
    t.assert((await pathname(dn)) === '/', `landed on ${await pathname(dn)}`);
    return 'list';
  });

  await t.step('no page exceptions or console errors on either device', async () => {
    const all = [...gps.pageErrors, ...gps.errors, ...dn.pageErrors, ...dn.errors];
    t.assert(all.length === 0, all.slice(0, 3).join(' | '));
    return 'none';
  });

  await browser.close();
  t.finish(`screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
