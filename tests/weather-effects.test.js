// Exercises WeatherEffects across every sky mood. The real forecast is fetched and then ONE thing is changed on its
// way in — current.weather_code / is_day / temperature_2m — because real weather right now is whatever it is, and
// this is the only way to prove each of the 8 sky buckets renders the right particle layer (and only that layer).

const path = require('path');
const fs = require('fs');
const H = require('./helpers/app');

const SHOTS = path.join(__dirname, 'shots-effects');

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
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = H.createRunner('Quarc Weather — weather background effects');
  const browser = await H.launch();

  const d = await H.freshSession(browser, { name: 'effects' });
  await t.step('sign in, save Istanbul and open it (a real forecast, to be altered per case)', async () => {
    await H.goList(d);
    await H.addCityByName(d, 'Istanbul', 'Istanbul');
    await H.waitCards(d, { has: ['Istanbul'] });
    await H.cardButton(d, 'Istanbul');
    await d.page.waitForFunction(() => location.pathname.startsWith('/city/'), { timeout: 15000 });
    await d.page.waitForSelector('.sky h1', { timeout: 20000 });
    return 'opened Istanbul';
  });

  for (const [code, isDay, temp, expect, forbid, label] of CASES) {
    await t.step(label, async () => {
      d.forecast.mutate = (json) => {
        json.current.weather_code = code;
        json.current.is_day = isDay;
        json.current.temperature_2m = temp;
        return json;
      };
      await H.clearForecastCache(d); // otherwise the cached real forecast would be shown
      await d.page.reload({ waitUntil: 'networkidle2' });
      await d.page.waitForSelector('.sky h1', { timeout: 20000 });
      await H.sleep(900);

      for (const sel of expect) {
        const n = await d.page.evaluate((s) => document.querySelectorAll(s).length, sel);
        t.assert(n > 0, `expected at least one ${sel}, found ${n}`);
      }
      for (const sel of forbid) {
        const n = await d.page.evaluate((s) => document.querySelectorAll(s).length, sel);
        t.assert(n === 0, `expected no ${sel}, found ${n}`);
      }
      const shotName = label.split(' ')[0].replace(/[^a-z0-9]/gi, '') + '-' + code + '-' + isDay;
      await d.page.screenshot({ path: `${SHOTS}/${shotName}.png` });
      return `${expect.join(', ')} present; ${forbid.join(', ') || 'nothing forbidden'} absent`;
    });
  }

  await t.step('reduced motion is honored (animation-duration clamps to ~0)', async () => {
    d.forecast.mutate = (json) => {
      json.current.weather_code = 63; // rain: plenty of animated particles
      json.current.is_day = 1;
      return json;
    };
    const calm = await H.newDevice(browser, { name: 'reduced', reducedMotion: true });
    await H.login(calm);
    const userId = await H.currentUserId(calm);
    calm.forecast.mutate = d.forecast.mutate;
    await H.goList(calm);
    await H.waitCards(calm, { has: ['Istanbul'] }, 25000);
    await H.cardButton(calm, 'Istanbul');
    await calm.page.waitForFunction(() => location.pathname.startsWith('/city/'), { timeout: 15000 });
    await H.sleep(900);
    const dur = await calm.page.evaluate(() => {
      const el = document.querySelector('.weather-sun-glow, .weather-raindrop, .weather-snowflake, .weather-star, .weather-cloud, .weather-fog-band');
      return el ? getComputedStyle(el).animationDuration : null;
    });
    t.assert(userId, 'no user');
    t.assert(dur !== null, 'no animated particle found to check');
    t.assert(/^0\.01ms/.test(dur) || parseFloat(dur) < 0.01, `expected ~0.01ms animation-duration under reduced motion, got ${dur}`);
    return `animation-duration clamped to ${dur} under prefers-reduced-motion`;
  });

  await browser.close();
  t.finish(`screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
