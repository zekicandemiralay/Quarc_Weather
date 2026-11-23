// The city screen in a real browser: how its data flows now (straight from the weather provider, cached on the device)
// and the cards on it.
//   - opening a city asks the PROVIDER (one forecast + one air-quality request) and never the Quarc server
//   - the heads-up card: the alerts are computed on the device from the forecast, so the test alters the forecast
//     (a storm, a gale, heavy rain) and checks the whole chain: provider data -> alert logic -> card
//   - the hourly strip places a sunrise/sunset that isn't "today's" (the bug where evening users never saw tomorrow's)
//   - pull-to-refresh refetches only when the cached copy is old enough, only from the top, and only for a long pull
//   - when the weather provider can't be reached, the last good forecast is shown, flagged offline
//   - miles vs km follows the unit the provider actually sent; the moon mirrors in the southern hemisphere

const path = require('path');
const fs = require('fs');
const H = require('./helpers/app');

const SHOTS = path.join(__dirname, 'shots-screen');
const TZ = 'Europe/Istanbul';

const pad = (n) => String(n).padStart(2, '0');
function nowHourIn(tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (x) => p.find((y) => y.type === x).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:00`;
}
function addHours(iso, h) {
  const [d, tm] = iso.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = tm.split(':').map(Number);
  const x = new Date(Date.UTC(y, m - 1, dd, hh, mm) + h * 3600000);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

/** Flattens the next 48 hours of the real forecast to "nothing worth an alert". */
function calm(json) {
  const h = json.hourly;
  for (let i = 0; i < h.time.length; i++) {
    h.weather_code[i] = 1;
    h.precipitation[i] = 0;
    h.wind_gusts_10m[i] = 10;
    h.apparent_temperature[i] = 20;
    h.uv_index[i] = 3;
    h.visibility[i] = 24000;
  }
  return json;
}
const nowIndex = (json) => json.hourly.time.findIndex((x) => x >= nowHourIn(TZ));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = H.createRunner('Quarc Weather — city screen');
  const browser = await H.launch();
  const d = await H.freshSession(browser, { name: 'screen', touch: true });
  const { page } = d;

  const reopen = async (clearCache = true) => {
    if (clearCache) await H.clearForecastCache(d);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('.sky h1', { timeout: 25000 });
    await page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
    await H.sleep(500);
  };

  await t.step('sign in, save Istanbul, open it', async () => {
    await H.goList(d);
    await H.addCityByName(d, 'Istanbul', 'Istanbul');
    await H.waitCards(d, { has: ['Istanbul'] });
    await H.cardButton(d, 'Istanbul');
    await page.waitForFunction(() => location.pathname.startsWith('/city/'), { timeout: 15000 });
    await page.waitForSelector('.sky h1', { timeout: 20000 });
    return page.url().split('/').pop();
  });

  t.section('Data flow');
  await t.step('a cold open asks the weather provider (forecast + air quality) and never the Quarc server', async () => {
    await H.clearForecastCache(d);
    const before = { provider: d.hits.provider, air: d.hits.airQuality, quarc: d.hits.quarcWeather, api: d.hits.apiCalls.length };
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
    await H.sleep(500);
    const provider = d.hits.provider - before.provider;
    const air = d.hits.airQuality - before.air;
    t.assert(provider === 1, `expected 1 forecast request, saw ${provider}`);
    t.assert(air === 1, `expected 1 air-quality request, saw ${air}`);
    t.assert(d.hits.quarcWeather === before.quarc, 'the Quarc server was asked for weather');
    return '1 forecast + 1 air quality, 0 server weather';
  });
  await t.step('a second open within 10 minutes is served from the device (no new request)', async () => {
    const before = d.hits.provider;
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
    t.assert(d.hits.provider === before, `${d.hits.provider - before} new provider requests`);
    return 'cache hit';
  });
  await t.step('the footer says how fresh the data is', async () => {
    const txt = await H.text(d);
    t.assert(/Open-Meteo · Europe\/Istanbul · Updated/.test(txt), `footer: ${txt.split('\n').slice(-3).join(' | ')}`);
    return 'Updated … shown';
  });

  t.section('Heads-up card (alerts computed on the device from the forecast)');
  await t.step('a storm, heavy rain and a gale in the forecast become correctly worded, correctly ordered alerts', async () => {
    d.forecast.mutate = (json) => {
      calm(json);
      const i = nowIndex(json);
      for (const k of [3, 4, 5]) json.hourly.weather_code[i + k] = 99; // thunderstorm with hail -> warning
      for (const k of [1, 2]) json.hourly.precipitation[i + k] = 6.5; // heavy rain -> advisory
      for (const k of [26, 27, 28, 29]) json.hourly.wind_gusts_10m[i + k] = 72; // gale tomorrow -> advisory
      d.stormWindow = { start: json.hourly.time[i + 3].slice(11, 16), end: addHours(json.hourly.time[i + 5], 1).slice(11, 16) };
      return json;
    };
    await reopen();
    t.assert(await page.$('[data-testid="alerts-card"]'), 'alerts card not rendered');
    const card = await page.$eval('[data-testid="alerts-card"]', (el) => el.textContent); // textContent: innerText applies CSS uppercase
    for (const want of ['Heads-up', 'Thunderstorms', 'Warning', d.stormWindow.start, d.stormWindow.end, 'Heavy rain', 'Up to 6.5 mm/h', 'Strong wind', 'Gusts up to 72 km/h', 'not official']) {
      t.assert(card.includes(want), `missing "${want}" in:\n${card}`);
    }
    const levels = await page.$$eval('[data-testid="alerts-card"] li', (els) => els.map((e) => e.dataset.level));
    t.assert(levels.join() === '2,1,1', `severity order was ${levels}`);
    await page.screenshot({ path: path.join(SHOTS, 'alerts-en.png') });
    return '3 alerts: warning first';
  });
  await t.step('a calm forecast → no card at all (it must not render an empty box)', async () => {
    d.forecast.mutate = calm;
    await reopen();
    t.assert(!(await page.$('[data-testid="alerts-card"]')), 'card rendered with zero alerts');
    return 'absent';
  });
  await t.step('the card is localised (Turkish)', async () => {
    d.forecast.mutate = (json) => { calm(json); for (const k of [26, 27]) json.hourly.weather_code[nowIndex(json) + k] = 95; return json; };
    // Switch the language through the app's own Settings screen, as a person would.
    await page.evaluate(() => Array.from(document.querySelectorAll('header button')).find((b) => b.getAttribute('aria-label') === 'Settings').click());
    await page.waitForFunction(() => location.pathname === '/settings', { timeout: 10000 });
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Türkçe').click());
    await page.waitForFunction(() => /Ayarlar/.test(document.body.textContent), { timeout: 10000 });
    try {
      await H.clearForecastCache(d);
      // The helper's goList() looks for English labels, so navigate by hand while the app is in Turkish:
      // Settings' back button, then the Istanbul card.
      await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('‹')).click());
      // Back from Settings lands on the city we came from (history), or on the list — handle either.
      await page.waitForFunction(() => location.pathname !== '/settings', { timeout: 10000 });
      await H.sleep(800);
      if ((await page.evaluate(() => location.pathname)) === '/') {
        await page.waitForFunction(() => Array.from(document.querySelectorAll('ul > li')).some((li) => li.textContent.includes('Istanbul')), { timeout: 15000 });
        await H.cardButton(d, 'Istanbul');
      }
      await page.waitForSelector('[data-testid="alerts-card"]', { timeout: 25000 });
      const card = await page.$eval('[data-testid="alerts-card"]', (el) => el.textContent);
      for (const want of ['Hava uyarıları', 'Gök gürültülü fırtına', 'Dikkat', 'resmî']) t.assert(card.includes(want), `missing "${want}" in:\n${card}`);
      await page.screenshot({ path: path.join(SHOTS, 'alerts-tr.png') });
      return 'Turkish strings';
    } finally {
      // Always restore English, or every later step would run in Turkish.
      await page.goto(`${H.BASE}/settings`, { waitUntil: 'networkidle2' });
      await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'English').click());
      await page.waitForFunction(() => /Settings/.test(document.body.textContent), { timeout: 10000 });
    }
  });

  t.section('Hourly strip');
  await t.step("a sunrise that is NOT today's still lands in the strip", async () => {
    await H.goList(d);
    await H.cardButton(d, 'Istanbul');
    await page.waitForSelector('.sky h1', { timeout: 20000 });
    const target = addHours(nowHourIn(TZ), 3).replace(/:00$/, ':30'); // 3½ hours from now — always inside the 24 h window
    const hhmm = target.slice(11, 16);
    d.forecast.mutate = (json) => {
      calm(json);
      json.daily.sunrise[1] = `${json.daily.time[1]}T00:10`; // today's: already past (or outside) — must not be the one that shows
      json.daily.sunrise[2] = target; // "tomorrow's" slot: the old code never looked past index 1
      return json;
    };
    await reopen();
    const cells = await page.$$eval('section', (secs) => {
      const s = secs.find((x) => /hourly forecast/i.test(x.textContent));
      return s ? Array.from(s.querySelectorAll('.flex-col')).map((c) => c.textContent.replace(/\s+/g, ' ')) : [];
    });
    t.assert(cells.some((c) => c.includes(hhmm) && /sunrise/i.test(c)), `no "${hhmm} Sunrise" cell. Cells: ${cells.slice(0, 12).join(' | ')}`);
    await page.screenshot({ path: path.join(SHOTS, 'hourly-sunrise.png') });
    return `"${hhmm} Sunrise" present`;
  });

  t.section('Pull to refresh');
  const pull = (distance, scrollTop = 0) =>
    page.evaluate(async (dist, top) => {
      const el = document.querySelector('.sky.overflow-y-auto') || document.querySelector('.sky');
      el.scrollTop = top;
      const mk = (y) => new Touch({ identifier: 1, target: el, clientX: 215, clientY: y });
      const fire = (type, y) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [mk(y)], changedTouches: [mk(y)] }));
      fire('touchstart', 200);
      fire('touchmove', 200 + dist / 2);
      fire('touchmove', 200 + dist);
      fire('touchend', 200 + dist);
      return el.scrollTop;
    }, distance, scrollTop);

  await t.step('a pull on a FRESH forecast does not hit the provider (rate-limited to once per 30 s)', async () => {
    d.forecast.mutate = null;
    await reopen();
    const before = d.hits.provider;
    await pull(440);
    await H.sleep(1200);
    t.assert(d.hits.provider === before, `${d.hits.provider - before} requests for a forecast fetched seconds ago`);
    return 'no request';
  });
  await t.step('a long pull from the top on an OLD forecast fetches a new one', async () => {
    await H.ageForecastCache(d, 2 * 60 * 1000);
    const before = d.hits.provider;
    await pull(440);
    await page.waitForFunction(() => true);
    await H.sleep(2500);
    t.assert(d.hits.provider === before + 1, `expected 1 new forecast request, saw ${d.hits.provider - before}`);
    return '1 request';
  });
  await t.step('a short pull does nothing', async () => {
    await H.ageForecastCache(d, 2 * 60 * 1000);
    const before = d.hits.provider;
    await pull(30);
    await H.sleep(1000);
    t.assert(d.hits.provider === before, 'a 30px pull triggered a refresh');
    return 'no request';
  });
  await t.step('pulling while scrolled away from the top does nothing', async () => {
    await H.ageForecastCache(d, 2 * 60 * 1000);
    await page.evaluate(() => { document.querySelector('.sky.overflow-y-auto').scrollTop = 400; });
    const before = d.hits.provider;
    const scrolled = await pull(440, 400);
    await H.sleep(1000);
    t.assert(scrolled > 0, 'page was not actually scrolled');
    t.assert(d.hits.provider === before, 'refresh fired while scrolled away from the top');
    return 'no request';
  });

  t.section('Weather provider unreachable');
  await t.step('the last good forecast is shown, flagged offline, when the provider cannot be reached', async () => {
    await H.ageForecastCache(d, 30 * 60 * 1000); // stale: a refresh will be attempted
    d.providerBlocked = true;
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => /Offline — showing last known conditions/.test(document.body.textContent), { timeout: 25000 });
    const txt = await H.text(d);
    t.assert(/Hourly forecast/i.test(txt), 'forecast cards missing');
    t.assert(!(await page.$('[data-testid="alerts-card"]')), 'a stale copy must not show the heads-up card');
    d.providerBlocked = false;
    return 'cached copy + offline banner';
  });

  t.section('Units and hemisphere');
  const visibilityTile = () =>
    page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find((x) => /visibility/i.test(x.textContent));
      return h ? h.parentElement.textContent.replace(/\s+/g, ' ').trim() : null;
    });
  const setUnit = async (label) => {
    await H.goList(d);
    await page.click('button[aria-label="Settings"]');
    await page.waitForFunction(() => location.pathname === '/settings', { timeout: 10000 });
    await page.evaluate((l) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === l).click(), label);
    await H.sleep(400);
  };
  await t.step('inches (the provider then reports FEET): visibility is shown in miles, never "km" computed from feet', async () => {
    await setUnit('in');
    try {
      await H.clearForecastCache(d);
      await H.goList(d);
      await H.cardButton(d, 'Istanbul');
      await page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
      const tile = await visibilityTile();
      t.assert(tile && /\d\s?mi(?![a-z])/.test(tile) && !/\d\s?km/.test(tile), `tile was: ${tile}`);
      return tile;
    } finally {
      await setUnit('mm');
    }
  });
  await t.step('metric: visibility is shown in km', async () => {
    await H.clearForecastCache(d);
    await H.goList(d);
    await H.cardButton(d, 'Istanbul');
    await page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
    const tile = await visibilityTile();
    t.assert(tile && /\d\s?km/.test(tile) && !/\d\s?mi(?![a-z])/.test(tile), `tile was: ${tile}`);
    return tile;
  });
  await t.step('the moon is mirrored for a southern-hemisphere city and not for a northern one', async () => {
    const mirrored = () =>
      page.evaluate(() => {
        const h = Array.from(document.querySelectorAll('h3')).find((x) => /moon/i.test(x.textContent));
        const svg = h?.parentElement.querySelector('svg');
        return svg ? svg.style.transform.includes('scaleX(-1)') : null;
      });
    const north = await mirrored();
    await H.goList(d);
    await H.addCityByName(d, 'Sydney', 'Sydney');
    await H.waitCards(d, { has: ['Sydney'] });
    await H.cardButton(d, 'Sydney');
    await page.waitForFunction(() => /Moon phase/i.test(document.body.textContent), { timeout: 25000 });
    const south = await mirrored();
    t.assert(north === false, `Istanbul moon mirrored=${north}`);
    t.assert(south === true, `Sydney moon mirrored=${south}`);
    return 'Istanbul normal, Sydney mirrored';
  });

  t.section('Runtime errors');
  await t.step('no page exceptions or console errors', async () => {
    const all = [...d.pageErrors, ...d.errors];
    t.assert(all.length === 0, all.slice(0, 3).join(' | '));
    return 'none';
  });

  await browser.close();
  t.finish(`screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
