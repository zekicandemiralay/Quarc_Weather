// Drives the real built app in headless Chrome against the real stack: login, add a city, a real forecast, settings,
// Turkish, logout. Captures every console error and page exception — that is what catches runtime React bugs a
// successful `vite build` cannot. Also proves the weather never goes through the Quarc server.

const path = require('path');
const fs = require('fs');
const H = require('./helpers/app');

const SHOTS = path.join(__dirname, 'shots');

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = H.createRunner('Quarc Weather — UI test');
  const browser = await H.launch();
  const d = await H.newDevice(browser, { name: 'ui' });
  const { page } = d;

  t.section('Login');
  await t.step('login screen renders', async () => {
    await page.goto(H.BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    const heading = await page.$eval('h1', (el) => el.textContent);
    await page.screenshot({ path: path.join(SHOTS, '1-login.png') });
    return heading;
  });
  await t.step('shared-account note is shown', async () => {
    t.assert(/Quarc Music/.test(await H.text(d)), 'shared-account line missing');
    return 'present';
  });
  await t.step('logging in reaches the (empty) city list', async () => {
    await H.login(d);
    d.userId = await H.currentUserId(d);
    await H.resetAccount(d.userId);
    await H.goList(d);
    const txt = await H.text(d);
    t.assert(!/Sign in to your Quarc account/.test(txt), 'still on login screen');
    t.assert(/No cities yet/.test(txt), 'empty state missing');
    await page.screenshot({ path: path.join(SHOTS, '2-empty-list.png') });
    return 'authenticated';
  });

  t.section('Add a city');
  await t.step('searching and picking a city puts it on the list with a real temperature and condition', async () => {
    await H.addCityByName(d, 'Istanbul', 'Istanbul');
    await H.waitCards(d, { has: ['Istanbul'] });
    await page.waitForFunction(() => /\d/.test(document.querySelector('ul > li .text-5xl')?.textContent || ''), { timeout: 20000 });
    const card = await page.$eval('ul > li', (li) => ({ temp: li.querySelector('.text-5xl')?.textContent, text: li.innerText }));
    t.assert(/-?\d+/.test(card.temp), `no temperature: ${card.temp}`);
    t.assert(/H:\s*-?\d+°\s+L:\s*-?\d+°/.test(card.text), `no high/low: ${card.text}`);
    await page.screenshot({ path: path.join(SHOTS, '3-list.png') });
    return `${card.temp}°`;
  });
  await t.step('the city reaches the server (sync), and only manual cities do', async () => {
    const s = await H.waitServer(d.userId, (x) => x.cities.includes('Istanbul'), 'Istanbul');
    t.assert(s.cities.join() === 'Istanbul', s.cities.join());
    return 'synced';
  });

  t.section('Forecast screen');
  let celsius;
  await t.step('opening the city renders the full forecast', async () => {
    await H.cardButton(d, 'Istanbul');
    await page.waitForFunction(() => location.pathname.startsWith('/city/'), { timeout: 10000 });
    await page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent) && /10-day forecast/i.test(document.body.textContent), { timeout: 25000 });
    const info = await page.evaluate(() => ({
      name: document.querySelector('h1')?.textContent.trim(),
      temp: document.querySelector('.text-\\[86px\\]')?.textContent.trim(),
    }));
    t.assert(/Istanbul/.test(info.name), `city name: ${info.name}`);
    celsius = Number(info.temp);
    t.assert(Number.isFinite(celsius), `temperature: ${info.temp}`);
    await page.screenshot({ path: path.join(SHOTS, '4-city.png') });
    return `${info.name}, ${celsius}°`;
  });
  await t.step('the hourly strip has 24 hours and the 10-day list has 10 rows', async () => {
    const counts = await page.evaluate(() => {
      const section = (re) => Array.from(document.querySelectorAll('section')).find((s) => re.test(s.textContent));
      return {
        hours: section(/hourly forecast/i).querySelectorAll('.rounded-xl').length,
        days: section(/10-day forecast/i).querySelectorAll('li').length,
      };
    });
    t.assert(counts.hours === 24, `${counts.hours} hourly cells`);
    t.assert(counts.days === 10, `${counts.days} daily rows`);
    return '24 + 10';
  });
  await t.step('the detail tiles are present (UV, wind, sunrise, feels like, humidity, visibility, pressure, moon)', async () => {
    const body = (await page.evaluate(() => document.body.textContent)).toLowerCase();
    for (const label of ['uv index', 'wind', 'sunrise', 'feels like', 'precipitation', 'visibility', 'pressure', 'moon phase']) {
      t.assert(body.includes(label), `missing tile: ${label}`);
    }
    return '8 tiles';
  });
  await t.step('the forecast came from the weather provider, never through the Quarc server', async () => {
    t.assert(d.hits.provider >= 1, 'no provider request');
    t.assert(d.hits.quarcWeather === 0, `Quarc server asked for weather ${d.hits.quarcWeather}×`);
    return `provider ×${d.hits.provider}, server weather ×0`;
  });

  t.section('Settings');
  await t.step('switching to °F refetches the forecast in Fahrenheit', async () => {
    await page.evaluate(() => Array.from(document.querySelectorAll('header button')).find((b) => b.getAttribute('aria-label') === 'Settings').click());
    await page.waitForFunction(() => location.pathname === '/settings', { timeout: 10000 });
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '°F').click());
    await H.sleep(500);
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Weather') && b.textContent.includes('‹')).click());
    await page.waitForFunction(() => location.pathname === '/', { timeout: 10000 });
    await H.cardButton(d, 'Istanbul');
    await page.waitForFunction((c) => {
      const n = Number(document.querySelector('.text-\\[86px\\]')?.textContent);
      return Number.isFinite(n) && Math.abs(n - (c * 9 / 5 + 32)) <= 2;
    }, { timeout: 25000 }, celsius);
    await page.screenshot({ path: path.join(SHOTS, '5-fahrenheit.png') });
    return `${celsius}°C → °F`;
  });
  await t.step('the unit choice is synced to the account', async () => {
    const s = await H.waitServer(d.userId, (x) => x.prefs && x.prefs.fields.units.value === 'imperial', 'units=imperial');
    return s.prefs.fields.units.value;
  });
  await t.step('Turkish: the interface language switches and persists', async () => {
    await page.evaluate(() => Array.from(document.querySelectorAll('header button')).find((b) => b.getAttribute('aria-label')).click()).catch(() => {});
    await H.goList(d);
    await page.click('button[aria-label="Settings"]');
    await page.waitForFunction(() => location.pathname === '/settings', { timeout: 10000 });
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Türkçe').click());
    await page.waitForFunction(() => /Ayarlar/.test(document.body.textContent), { timeout: 10000 });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => /Ayarlar/.test(document.body.textContent), { timeout: 10000 });
    await page.screenshot({ path: path.join(SHOTS, '6-turkish.png') });
    // back to English for the rest
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'English').click());
    await page.waitForFunction(() => /Settings/.test(document.body.textContent), { timeout: 10000 });
    return 'Ayarlar';
  });

  t.section('Logout');
  await t.step('logging out returns to the login screen, and signing back in restores the list from this device', async () => {
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => /log out/i.test(b.textContent)).click());
    await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
    await H.login(d);
    await H.goList(d);
    await H.waitCards(d, { has: ['Istanbul'] });
    return 'Istanbul still there';
  });

  t.section('Runtime errors');
  await t.step('no console errors or page exceptions', async () => {
    const all = [...d.pageErrors, ...d.errors];
    t.assert(all.length === 0, all.slice(0, 3).join(' | '));
    return 'none';
  });

  await browser.close();
  t.finish(`screenshots: ${SHOTS}`);
})();
