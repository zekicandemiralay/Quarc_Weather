// The precipitation radar card (RadarMap.jsx) against the real RainViewer + Esri tile services (both free, no key),
// no mocks: collapsed by default with zero map/tile requests until tapped; expanding mounts a real Leaflet map and
// loads real basemap tiles; radar frames load and play/pause works; collapse and re-expand tears down cleanly.
//
// Depends on two live third-party services, so — like update-banner — a failure here can be THEIR outage.

const path = require('path');
const fs = require('fs');
const H = require('./helpers/app');

const SHOTS = path.join(__dirname, 'shots-radar');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = H.createRunner('Quarc Weather — precipitation radar');
  const browser = await H.launch();
  const d = await H.freshSession(browser, { name: 'radar' });
  const { page } = d;

  await t.step('sign in, save Istanbul and open it', async () => {
    await H.goList(d);
    await H.addCityByName(d, 'Istanbul', 'Istanbul');
    await H.waitCards(d, { has: ['Istanbul'] });
    await H.cardButton(d, 'Istanbul');
    await page.waitForFunction(() => location.pathname.startsWith('/city/'), { timeout: 15000 });
    await page.waitForSelector('.sky h1', { timeout: 20000 });
    await H.sleep(500);
    return 'opened Istanbul';
  });

  await t.step('radar card is present but collapsed (no map, no tile requests) by default', async () => {
    const txt = await page.evaluate(() => document.body.innerText);
    t.assert(/radar/i.test(txt), `no "radar" text found: ${txt.slice(0, 200)}`);
    const leafletContainers = await page.evaluate(() => document.querySelectorAll('.leaflet-container').length);
    t.assert(leafletContainers === 0, `expected no map mounted before expanding, found ${leafletContainers}`);
    return 'card visible, map not mounted';
  });

  await t.step('tapping the radar card expands it, mounts a real Leaflet map, and loads real Esri basemap tiles', async () => {
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
    await H.sleep(2500);

    page.off('response', onResp);
    t.assert(tileResponses.length > 0, 'no Esri tile requests observed during expand');
    t.assert(tileResponses.every((s) => s === 200), `expected all 200s, got ${tileResponses.join(',')}`);
    return `map mounted, ${tileResponses.length} basemap tiles loaded, all 200`;
  });

  await t.step('radar frames load from RainViewer and the play/pause control works', async () => {
    await page.waitForFunction(() => !!document.querySelector('input[type="range"]'), { timeout: 15000 });
    // The slider's max is only set once frames actually loaded.
    const max = await page.evaluate(() => Number(document.querySelector('input[type="range"]')?.max ?? -1));
    t.assert(max > 0, `expected a multi-frame radar loop, slider max was ${max}`);

    const playBtn = await page.$('button[aria-label="Pause"], button[aria-label="Play"]');
    t.assert(playBtn, 'no play/pause button found');
    const before = await page.evaluate((el) => el.getAttribute('aria-label'), playBtn);
    await playBtn.click();
    const after = await page.evaluate((el) => el.getAttribute('aria-label'), playBtn);
    t.assert(before !== after, `expected aria-label to toggle, stayed "${before}"`);

    await page.screenshot({ path: `${SHOTS}/1-radar-expanded.png` });
    return `${max + 1} radar frames loaded, play/pause toggled ${before} -> ${after}`;
  });

  await t.step('collapsing and re-expanding tears down and remounts cleanly (no console errors)', async () => {
    const errors = [];
    const onErr = (e) => errors.push(e.message);
    page.on('pageerror', onErr);

    const toggle = () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /radar/i.test(b.textContent))?.click());
    await toggle();
    await H.sleep(300);
    const gone = await page.evaluate(() => document.querySelectorAll('.leaflet-container').length);
    t.assert(gone === 0, `expected map removed after collapse, found ${gone}`);

    await toggle();
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });
    await H.sleep(1000);

    page.off('pageerror', onErr);
    t.assert(errors.length === 0, `page errors on remount: ${errors.join('; ')}`);
    return 'clean teardown + remount, no errors';
  });

  await browser.close();
  t.finish(`screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
