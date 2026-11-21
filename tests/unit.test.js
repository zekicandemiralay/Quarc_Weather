// Pure-logic tests — no server, no network, no browser. These run in seconds
// and are what CI runs on every push. Covers the pieces that decide what the
// user is told: the forecast-based alerts, the hourly strip's sunrise/sunset
// placement, and the alert time-window wording.
//
//   node --test tests/unit.test.js        (Node 20+)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const { computeAlerts } = require('../backend/src/services/alerts');
const { addHours, currentHourWallClock } = require('../backend/src/services/wallclock');

// The frontend libs are ES modules (frontend/package.json says "type": "module").
const fe = (rel) => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', rel)).href);

// --- helpers -----------------------------------------------------------------

/** A flat, boring 72-hour forecast starting 2026-06-10T00:00 (naive city time). */
function boringForecast(overrides = {}) {
  const time = [];
  for (let i = 0; i < 72; i++) {
    const d = new Date(Date.UTC(2026, 5, 10, i));
    time.push(d.toISOString().slice(0, 13) + ':00');
  }
  const fill = (v) => time.map(() => v);
  return {
    timezone: 'UTC',
    hourly_units: { temperature_2m: '°C', wind_gusts_10m: 'km/h', precipitation: 'mm' },
    hourly: {
      time,
      weather_code: fill(1),
      precipitation: fill(0),
      wind_gusts_10m: fill(10),
      apparent_temperature: fill(20),
      uv_index: fill(3),
      visibility: fill(24000),
      ...overrides,
    },
  };
}

/** Sets `hourly[field]` to `value` for each wall-clock hour index given. */
function withHours(field, hours, value) {
  const base = boringForecast();
  const arr = base.hourly[field].slice();
  for (const h of hours) arr[h] = value;
  return boringForecast({ [field]: arr });
}

/** Sets `hourly[field][hour] = value` for each [hour, value] pair. */
function withValues(field, pairs) {
  const base = boringForecast();
  const arr = base.hourly[field].slice();
  for (const [h, v] of Object.entries(pairs)) arr[Number(h)] = v;
  return boringForecast({ [field]: arr });
}

const NOW = new Date('2026-06-10T08:30:00Z'); // 08:00 hour in a UTC city

// --- wallclock ---------------------------------------------------------------

test('currentHourWallClock is the CITY hour, not the server hour', () => {
  // 08:30 UTC is 11:00 in Istanbul (UTC+3) and 04:00 in New York (UTC-4 in June).
  assert.equal(currentHourWallClock('UTC', NOW), '2026-06-10T08:00');
  assert.equal(currentHourWallClock('Europe/Istanbul', NOW), '2026-06-10T11:00');
  assert.equal(currentHourWallClock('America/New_York', NOW), '2026-06-10T04:00');
});

test('addHours rolls over midnight and month ends as pure calendar maths', () => {
  assert.equal(addHours('2026-06-10T23:00', 1), '2026-06-11T00:00');
  assert.equal(addHours('2026-06-30T23:00', 1), '2026-07-01T00:00');
  assert.equal(addHours('2026-12-31T22:00', 3), '2027-01-01T01:00');
});

// --- alerts ------------------------------------------------------------------

test('a calm forecast raises no alerts', () => {
  assert.deepEqual(computeAlerts(boringForecast(), 'UTC', NOW), []);
});

test('missing or empty forecast data is handled, not thrown on', () => {
  assert.deepEqual(computeAlerts(null, 'UTC', NOW), []);
  assert.deepEqual(computeAlerts({}, 'UTC', NOW), []);
  assert.deepEqual(computeAlerts({ hourly: { time: [] } }, 'UTC', NOW), []);
});

test('consecutive thunderstorm hours merge into one window with the right start/end', () => {
  const fc = withHours('weather_code', [14, 15, 16], 95);
  const [a, ...rest] = computeAlerts(fc, 'UTC', NOW);
  assert.equal(rest.length, 0);
  assert.equal(a.type, 'thunderstorm');
  assert.equal(a.level, 1);
  assert.equal(a.start, '2026-06-10T14:00');
  assert.equal(a.end, '2026-06-10T17:00'); // end of the last affected hour
  assert.equal(a.ongoing, false);
});

test('hail upgrades a thunderstorm window to a warning', () => {
  const fc = withValues('weather_code', { 14: 95, 15: 99 });
  const alerts = computeAlerts(fc, 'UTC', NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 2);
});

test('a gap of up to 2 quiet hours stays one event; a longer gap splits it', () => {
  const merged = computeAlerts(withHours('weather_code', [12, 14], 95), 'UTC', NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].start, '2026-06-10T12:00');
  assert.equal(merged[0].end, '2026-06-10T15:00');

  const split = computeAlerts(withHours('weather_code', [12, 15], 95), 'UTC', NOW);
  assert.equal(split.length, 2);
});

test('an alert already under way is flagged ongoing', () => {
  const alerts = computeAlerts(withHours('weather_code', [8, 9], 95), 'UTC', NOW);
  assert.equal(alerts[0].ongoing, true);
  assert.equal(alerts[0].start, '2026-06-10T08:00');
});

test('hours before "now" are ignored — yesterday\'s storm is not a heads-up', () => {
  assert.deepEqual(computeAlerts(withHours('weather_code', [2, 3, 4], 95), 'UTC', NOW), []);
});

test('only the next 48 hours are scanned', () => {
  // now is index 8 → window is indices 8..55; 60 is outside it.
  assert.deepEqual(computeAlerts(withHours('weather_code', [60], 95), 'UTC', NOW), []);
  assert.equal(computeAlerts(withHours('weather_code', [55], 95), 'UTC', NOW).length, 1);
});

test('"now" follows the CITY timezone: the same forecast reads differently in Istanbul', () => {
  // Storm at index 10 (10:00 city time). In UTC it is 2h away; in Istanbul "now" is 11:00, so it is already over.
  const fc = withHours('weather_code', [10], 95);
  assert.equal(computeAlerts(fc, 'UTC', NOW).length, 1);
  assert.equal(computeAlerts(fc, 'Europe/Istanbul', NOW).length, 0);
});

test('an event that runs past midnight ends on the next date', () => {
  const alerts = computeAlerts(withHours('weather_code', [22, 23], 95), 'UTC', NOW);
  assert.equal(alerts[0].start, '2026-06-10T22:00');
  assert.equal(alerts[0].end, '2026-06-11T00:00');
});

test('wind thresholds are unit-aware: the same gust is an advisory or nothing depending on the unit', () => {
  const kmh = (unit, value) => {
    const fc = withHours('wind_gusts_10m', [14], value);
    fc.hourly_units.wind_gusts_10m = unit;
    return computeAlerts(fc, 'UTC', NOW);
  };
  assert.equal(kmh('km/h', 70)[0].level, 1); // 70 km/h
  assert.equal(kmh('km/h', 95)[0].level, 2); // 95 km/h
  assert.equal(kmh('m/s', 20)[0].level, 1); // 20 m/s = 72 km/h
  assert.equal(kmh('mp/h', 20).length, 0); // 20 mph = 32 km/h — calm
  assert.equal(kmh('kn', 60)[0].level, 2); // 60 kn = 111 km/h
  const shown = kmh('m/s', 20)[0];
  assert.equal(shown.value, 20); // reported back in the user's own unit…
  assert.equal(shown.unit, 'm/s'); // …with its label
});

test('rain thresholds are unit-aware (inch vs mm)', () => {
  const rain = (unit, value) => {
    const fc = withHours('precipitation', [14], value);
    fc.hourly_units.precipitation = unit;
    return computeAlerts(fc, 'UTC', NOW);
  };
  assert.equal(rain('mm', 5)[0].level, 1);
  assert.equal(rain('mm', 12)[0].level, 2);
  assert.equal(rain('mm', 2).length, 0);
  assert.equal(rain('inch', 0.2)[0].level, 1); // 0.2" = 5.08 mm
  assert.equal(rain('inch', 0.05).length, 0); // 1.27 mm
});

test('heat and cold use the feels-like temperature, in the right unit', () => {
  const feels = (unit, value) => {
    const fc = withHours('apparent_temperature', [14], value);
    fc.hourly_units.temperature_2m = unit;
    return computeAlerts(fc, 'UTC', NOW);
  };
  assert.equal(feels('°C', 39)[0].type, 'heat');
  assert.equal(feels('°C', 43)[0].level, 2);
  assert.equal(feels('°F', 105)[0].type, 'heat'); // 105°F = 40.6°C
  assert.equal(feels('°F', 80).length, 0);
  assert.equal(feels('°C', -20)[0].type, 'cold');
  assert.equal(feels('°C', -26)[0].level, 2);
  assert.equal(feels('°F', -10)[0].type, 'cold'); // -10°F = -23.3°C
});

test('a heat window reports its PEAK, a cold window its minimum', () => {
  const heat = computeAlerts(withValues('apparent_temperature', { 13: 38.5, 14: 41, 15: 39 }), 'UTC', NOW);
  assert.equal(heat.length, 1);
  assert.equal(heat[0].value, 41);

  const cold = computeAlerts(withValues('apparent_temperature', { 13: -16, 14: -22, 15: -18 }), 'UTC', NOW);
  assert.equal(cold.length, 1);
  assert.equal(cold[0].value, -22);
});

test('freezing rain, heavy snow, dense fog and extreme UV are each detected', () => {
  assert.equal(computeAlerts(withHours('weather_code', [14], 66), 'UTC', NOW)[0].type, 'freezing_rain');
  assert.equal(computeAlerts(withHours('weather_code', [14], 67), 'UTC', NOW)[0].level, 2);
  assert.equal(computeAlerts(withHours('weather_code', [14], 75), 'UTC', NOW)[0].type, 'heavy_snow');
  assert.equal(computeAlerts(withHours('visibility', [14], 120), 'UTC', NOW)[0].type, 'dense_fog');
  assert.equal(computeAlerts(withHours('uv_index', [13], 11.4), 'UTC', NOW)[0].type, 'uv');
  assert.equal(computeAlerts(withHours('uv_index', [13], 9), 'UTC', NOW).length, 0); // "very high" is a normal summer day
});

test('dense fog is judged in metres even when Open-Meteo reports visibility in feet (imperial)', () => {
  const fog = (unit, value) => {
    const fc = withHours('visibility', [14], value);
    fc.hourly_units.visibility = unit;
    return computeAlerts(fc, 'UTC', NOW);
  };
  assert.equal(fog('m', 150).length, 1);
  assert.equal(fog('ft', 400).length, 1); // 400 ft = 122 m
  assert.equal(fog('ft', 1000).length, 0); // 1000 ft = 305 m — not dense fog (a raw "< 200" check would call it fog)
  assert.equal(fog('ft', 78000).length, 0); // a clear day, 24 km
});

test('alerts are sorted warnings-first, then by start time, and capped', () => {
  const fc = boringForecast();
  fc.hourly.weather_code[20] = 95; // thunderstorm advisory, later
  fc.hourly.wind_gusts_10m[30] = 100; // wind warning, even later
  fc.hourly.apparent_temperature[12] = 39; // heat advisory, earliest
  const alerts = computeAlerts(fc, 'UTC', NOW);
  assert.deepEqual(alerts.map((a) => a.type), ['strong_wind', 'heat', 'thunderstorm']);
});

// --- hourly strip -------------------------------------------------------------

test('hourly strip: after sunset the window includes TOMORROW\'s sunrise (the original bug)', async () => {
  const { buildHourlyCells } = await fe('hourly.js');
  const fc = boringForecast();
  // It is 21:00; the 24h window runs to 20:00 tomorrow, so tomorrow's 05:42 sunrise falls inside it.
  const daily = {
    sunrise: ['2026-06-09T05:41', '2026-06-10T05:42', '2026-06-11T05:42'],
    sunset: ['2026-06-09T20:10', '2026-06-10T20:11', '2026-06-11T20:11'],
  };
  const cells = buildHourlyCells({ hourly: fc.hourly, daily, nowHour: '2026-06-10T21:00' });
  const events = cells.filter((c) => c.kind !== 'hour').map((c) => `${c.kind}@${c.iso}`);
  // Today's sunset (20:11) is already behind us and tomorrow's (20:11 on the 11th) is past the window's
  // last hour (20:00) — so exactly one marker: tomorrow's sunrise. Before the fix this list was empty.
  assert.deepEqual(events, ['sunrise@2026-06-11T05:42']);
});

test('hourly strip: a morning window shows today\'s sunrise AND sunset in time order', async () => {
  const { buildHourlyCells } = await fe('hourly.js');
  const fc = boringForecast();
  const daily = {
    sunrise: ['2026-06-09T05:41', '2026-06-10T05:42', '2026-06-11T05:42'],
    sunset: ['2026-06-09T20:10', '2026-06-10T20:11', '2026-06-11T20:11'],
  };
  const cells = buildHourlyCells({ hourly: fc.hourly, daily, nowHour: '2026-06-10T04:00' });
  const marks = cells.filter((c) => c.kind !== 'hour');
  assert.deepEqual(marks.map((c) => c.kind), ['sunrise', 'sunset']);

  // Each marker sits between the hour before it and the hour after it.
  for (const m of marks) {
    const at = cells.indexOf(m);
    assert.ok(cells[at - 1].iso <= m.iso, 'marker must come after the hour that precedes it');
    assert.ok(cells[at + 1].iso > m.iso, 'marker must come before the hour that follows it');
  }
});

test('hourly strip: starts at the current hour, flags only that cell as "now", and is 24 hours long', async () => {
  const { buildHourlyCells } = await fe('hourly.js');
  const fc = boringForecast();
  const cells = buildHourlyCells({ hourly: fc.hourly, daily: {}, nowHour: '2026-06-10T09:00' });
  const hours = cells.filter((c) => c.kind === 'hour');
  assert.equal(hours.length, 24);
  assert.equal(hours[0].iso, '2026-06-10T09:00');
  assert.equal(hours.filter((c) => c.isNow).length, 1);
  assert.equal(hours[0].isNow, true);
});

test('hourly strip: sunrise before the first hour, or after the last, is left out', async () => {
  const { buildHourlyCells } = await fe('hourly.js');
  const fc = boringForecast();
  const cells = buildHourlyCells({
    hourly: fc.hourly,
    daily: { sunrise: ['2026-06-10T05:42', '2026-06-12T05:42'], sunset: [] },
    nowHour: '2026-06-10T09:00',
  });
  assert.equal(cells.filter((c) => c.kind !== 'hour').length, 0);
});

test('hourly strip: no data, no cells', async () => {
  const { buildHourlyCells } = await fe('hourly.js');
  assert.deepEqual(buildHourlyCells({ hourly: null, daily: {}, nowHour: 'x' }), []);
  assert.deepEqual(buildHourlyCells({ hourly: { time: [] }, daily: {}, nowHour: 'x' }), []);
});

// --- alert wording --------------------------------------------------------------

test('alert windows read naturally: today, tomorrow, overnight and ongoing', async () => {
  const { formatAlertWindow } = await fe('alerts.js');
  const labels = { now: 'Now', tomorrow: 'Tomorrow', weekday: () => 'Fri' };
  const today = '2026-06-10';

  assert.equal(formatAlertWindow({ start: '2026-06-10T14:00', end: '2026-06-10T18:00', ongoing: false }, today, labels), '14:00 – 18:00');
  assert.equal(formatAlertWindow({ start: '2026-06-11T02:00', end: '2026-06-11T06:00', ongoing: false }, today, labels), 'Tomorrow 02:00 – 06:00');
  assert.equal(formatAlertWindow({ start: '2026-06-10T22:00', end: '2026-06-11T02:00', ongoing: false }, today, labels), '22:00 – Tomorrow 02:00');
  assert.equal(formatAlertWindow({ start: '2026-06-10T08:00', end: '2026-06-10T11:00', ongoing: true }, today, labels), 'Now – 11:00');
  assert.equal(formatAlertWindow({ start: '2026-06-10T08:00', end: '2026-06-11T01:00', ongoing: true }, today, labels), 'Now – Tomorrow 01:00');
  assert.equal(formatAlertWindow({ start: '2026-06-12T09:00', end: '2026-06-12T10:00', ongoing: false }, today, labels), 'Fri 09:00 – 10:00');
});

test('shiftDate handles month and year ends', async () => {
  const { shiftDate } = await fe('alerts.js');
  assert.equal(shiftDate('2026-06-30', 1), '2026-07-01');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});

// --- number formatting ----------------------------------------------------------

test('visibility is shown in km (metric) or miles (imperial, where the API sends FEET)', async () => {
  const { visibilityDisplay } = await fe('format.js');
  assert.deepEqual(visibilityDisplay(24140, 'm'), { value: 24, unit: 'km' });
  assert.deepEqual(visibilityDisplay(400, 'm'), { value: 0.4, unit: 'km' }); // fog: must not round to "0 km"
  // 24,140 m = 79,198 ft = 15 mi. The old code printed 79 "km" here.
  assert.deepEqual(visibilityDisplay(79198, 'ft'), { value: 15, unit: 'mi' });
  assert.deepEqual(visibilityDisplay(2640, 'ft'), { value: 0.5, unit: 'mi' });
  assert.equal(visibilityDisplay(null, 'm'), null);
  assert.equal(visibilityDisplay(undefined, 'ft'), null);
});
