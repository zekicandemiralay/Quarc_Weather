// The app is viewed with the browser's timezone emulated to America/New_York while showing Istanbul — a 7–9 hour gap
// that can't coincidentally cancel out — proving every time on screen is computed in the CITY's timezone rather than
// silently re-interpreted in the viewer's. (Open-Meteo's hourly/daily timestamps are naive wall-clock strings in the
// city's own zone; reading them as device-local time is exactly the bug this guards against.)

const path = require('path');
const fs = require('fs');
const H = require('./helpers/app');

const SHOTS = path.join(__dirname, 'shots-timezone');
const CITY_TZ = 'Europe/Istanbul';

const pad = (n) => String(n).padStart(2, '0');
function istanbulNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: CITY_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return { hour: Number(p.find((x) => x.type === 'hour').value), minute: Number(p.find((x) => x.type === 'minute').value) };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = H.createRunner('Quarc Weather — timezone correctness (viewer in New York, city in Istanbul)');
  const browser = await H.launch();
  const d = await H.freshSession(browser, { name: 'tz', timezone: 'America/New_York' });
  const { page } = d;

  await t.step('the browser really is in New York (so the test can tell the two zones apart)', async () => {
    const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    t.assert(tz === 'America/New_York', `browser tz is ${tz}`);
    return tz;
  });

  await t.step('the city card shows the current time IN ISTANBUL, not New York', async () => {
    await H.goList(d);
    await H.addCityByName(d, 'Istanbul', 'Istanbul');
    await H.waitCards(d, { has: ['Istanbul'] });
    await H.sleep(800);
    const shown = await page.$eval('ul > li', (li) => li.querySelector('p.text-xs')?.textContent.trim());
    const [h, m] = shown.split(':').map(Number);
    const want = istanbulNow();
    const diff = Math.abs(h * 60 + m - (want.hour * 60 + want.minute));
    t.assert(Math.min(diff, 1440 - diff) <= 2, `card says ${shown}, Istanbul is ${pad(want.hour)}:${pad(want.minute)}`);
    await page.screenshot({ path: path.join(SHOTS, '1-card.png') });
    return `${shown} (Istanbul ${pad(want.hour)}:${pad(want.minute)})`;
  });

  await t.step('the hourly strip\'s "Now" cell is the current Istanbul hour, and the next cell is one hour later', async () => {
    await H.cardButton(d, 'Istanbul');
    await page.waitForFunction(() => /Hourly forecast/i.test(document.body.textContent), { timeout: 25000 });
    const cells = await page.evaluate(() => {
      const section = Array.from(document.querySelectorAll('section')).find((s) => /hourly forecast/i.test(s.textContent));
      return Array.from(section.querySelectorAll('.rounded-xl')).slice(0, 3).map((c) => c.querySelector('span')?.textContent.trim());
    });
    t.assert(cells[0] === 'Now', `first cell is "${cells[0]}"`);
    const want = istanbulNow();
    t.assert(Number(cells[1]) === (want.hour + 1) % 24, `second cell says ${cells[1]}, expected ${pad((want.hour + 1) % 24)}`);
    t.assert(Number(cells[2]) === (want.hour + 2) % 24, `third cell says ${cells[2]}, expected ${pad((want.hour + 2) % 24)}`);
    await page.screenshot({ path: path.join(SHOTS, '2-hourly.png') });
    return `Now, ${cells[1]}, ${cells[2]}  (Istanbul hour is ${pad(want.hour)})`;
  });

  await t.step('the sunrise shown is Open-Meteo\'s Istanbul sunrise verbatim — not shifted by the viewer\'s zone', async () => {
    const city = await H.serverState(d.userId).then((s) => s.all.find((c) => c.name === 'Istanbul'));
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&daily=sunrise&timezone=auto&forecast_days=2&past_days=1`);
    const j = await r.json();
    const wanted = j.daily.sunrise[1].slice(11, 16); // today's sunrise, "HH:mm", in the city's own zone
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const shown = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find((x) => /sunrise/i.test(x.textContent));
      return h ? h.parentElement.querySelector('p.text-3xl')?.textContent.trim() : null;
    });
    await page.screenshot({ path: path.join(SHOTS, '3-sunrise.png') });
    t.assert(shown === wanted, `app shows ${shown}, Open-Meteo says ${wanted}`);
    return `${shown}`;
  });

  await browser.close();
  t.finish(`screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
