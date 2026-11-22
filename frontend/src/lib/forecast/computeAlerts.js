// Forecast-based heads-ups.
//
// Open-Meteo is a model-data service: it has no official government warnings.
// What it does have is an hourly forecast, so this scans the next 48 hours for
// conditions that are worth a heads-up (thunderstorms, torrential rain, gales,
// ice, extreme heat/cold, ...) and merges consecutive hours into one window.
//
// These are *automated advisories derived from the forecast*, not official
// warnings — the UI says so. Thresholds are in SI-ish units (mm/h, km/h, °C);
// the forecast arrives in whatever units the user picked, so everything is
// normalised through the unit strings Open-Meteo returns before comparing.
//
// (Presentation of these alerts — wording, icons — lives in ../alerts.js.)

import { currentHourWallClock, addHours } from '../wallclock.js';

const WINDOW_HOURS = 48;
const MAX_GAP_HOURS = 2; // hours still count as one event if a quiet gap is this short or less
const MAX_ALERTS = 6;

// --- unit normalisation ------------------------------------------------------
const toCelsius = (v, unit) => (unit === '°F' ? ((v - 32) * 5) / 9 : v);
const toKmh = (v, unit) => {
  switch (unit) {
    case 'm/s': return v * 3.6;
    case 'mp/h': return v * 1.609344;
    case 'kn': return v * 1.852;
    default: return v; // km/h
  }
};
const toMm = (v, unit) => (unit === 'inch' ? v * 25.4 : v);
// Open-Meteo switches visibility to feet when the precipitation unit is inches.
const toMetres = (v, unit) => (unit === 'ft' ? v * 0.3048 : v);

// Severity: 1 = advisory, 2 = warning.
const level = (value, advisoryAt, warningAt) => (value >= warningAt ? 2 : value >= advisoryAt ? 1 : 0);
const levelBelow = (value, advisoryAt, warningAt) => (value <= warningAt ? 2 : value <= advisoryAt ? 1 : 0);

/**
 * Each rule inspects one hour and returns `{ level, value?, unit? }` or null.
 * `value`/`unit` are the figure to show — in the user's own units.
 */
const RULES = [
  {
    type: 'thunderstorm',
    check: (h) => {
      const code = h.code;
      if (code === 96 || code === 99) return { level: 2 }; // with hail
      if (code === 95) return { level: 1 };
      return null;
    },
  },
  {
    type: 'heavy_rain',
    check: (h) => {
      if (h.precip == null) return null;
      const lvl = level(toMm(h.precip, h.units.precip), 4, 10);
      return lvl ? { level: lvl, value: h.precip, unit: h.units.precip } : null;
    },
  },
  {
    type: 'strong_wind',
    check: (h) => {
      if (h.gust == null) return null;
      const lvl = level(toKmh(h.gust, h.units.wind), 60, 90);
      return lvl ? { level: lvl, value: h.gust, unit: h.units.wind } : null;
    },
  },
  {
    type: 'heavy_snow',
    check: (h) => {
      if (h.code !== 75 && h.code !== 86) return null;
      // Heavy snow that is also dumping a lot of water-equivalent is the dangerous kind.
      return { level: h.precip != null && toMm(h.precip, h.units.precip) >= 3 ? 2 : 1 };
    },
  },
  {
    type: 'freezing_rain',
    check: (h) => {
      if (h.code === 57 || h.code === 67) return { level: 2 };
      if (h.code === 56 || h.code === 66) return { level: 1 };
      return null;
    },
  },
  {
    type: 'heat',
    check: (h) => {
      if (h.feels == null) return null;
      const lvl = level(toCelsius(h.feels, h.units.temp), 38, 42);
      return lvl ? { level: lvl, value: h.feels, unit: h.units.temp } : null;
    },
  },
  {
    type: 'cold',
    check: (h) => {
      if (h.feels == null) return null;
      const lvl = levelBelow(toCelsius(h.feels, h.units.temp), -15, -25);
      return lvl ? { level: lvl, value: h.feels, unit: h.units.temp } : null;
    },
  },
  {
    type: 'uv',
    check: (h) => (h.uv != null && h.uv >= 11 ? { level: 1, value: h.uv } : null),
  },
  {
    type: 'dense_fog',
    check: (h) => (h.visibility != null && toMetres(h.visibility, h.units.visibility) < 200 ? { level: 1 } : null),
  },
];

// For "peak" display: heat/uv/rain/wind peak is the max, cold's is the min.
const PEAK_IS_MIN = new Set(['cold']);

/**
 * @param forecast  an Open-Meteo forecast bundle (hourly + hourly_units)
 * @param timezone  IANA zone of the city — decides what "now" is
 * @param now       injectable clock for tests
 * @returns Array<{ type, level, start, end, ongoing, value?, unit? }>
 *   `start`/`end` are naive city wall-clock strings; `end` is the *end* of the
 *   last affected hour.
 */
export function computeAlerts(forecast, timezone, now = new Date()) {
  const hourly = forecast?.hourly;
  if (!hourly?.time?.length) return [];

  const nowHour = currentHourWallClock(timezone || forecast.timezone, now);
  const first = Math.max(0, hourly.time.findIndex((iso) => !nowHour || iso >= nowHour));
  const last = Math.min(hourly.time.length, first + WINDOW_HOURS);

  const hu = forecast.hourly_units || {};
  const units = {
    temp: hu.temperature_2m || '°C',
    wind: hu.wind_gusts_10m || 'km/h',
    precip: hu.precipitation || 'mm',
    visibility: hu.visibility || 'm',
  };

  const hours = [];
  for (let i = first; i < last; i++) {
    hours.push({
      i,
      time: hourly.time[i],
      code: hourly.weather_code?.[i],
      precip: hourly.precipitation?.[i],
      gust: hourly.wind_gusts_10m?.[i],
      feels: hourly.apparent_temperature?.[i],
      uv: hourly.uv_index?.[i],
      visibility: hourly.visibility?.[i],
      units,
    });
  }

  const alerts = [];

  for (const rule of RULES) {
    let open = null;

    const close = () => {
      if (!open) return;
      alerts.push({
        type: rule.type,
        level: open.level,
        start: open.startTime,
        end: addHours(open.lastTime, 1),
        ongoing: open.startPos === 0,
        ...(open.peak != null ? { value: Math.round(open.peak * 10) / 10, unit: open.unit } : {}),
      });
      open = null;
    };

    hours.forEach((h, pos) => {
      const hit = rule.check(h);
      if (!hit) return;

      if (open && pos - open.lastPos > MAX_GAP_HOURS) close();

      if (!open) {
        open = { startPos: pos, startTime: h.time, level: 0, peak: null, unit: hit.unit };
      }
      open.lastPos = pos;
      open.lastTime = h.time;
      open.level = Math.max(open.level, hit.level);
      if (hit.value != null) {
        const better = PEAK_IS_MIN.has(rule.type) ? hit.value < open.peak : hit.value > open.peak;
        if (open.peak == null || better) open.peak = hit.value;
        open.unit = hit.unit;
      }
    });
    close();
  }

  return alerts
    .sort((a, b) => b.level - a.level || a.start.localeCompare(b.start))
    .slice(0, MAX_ALERTS);
}
