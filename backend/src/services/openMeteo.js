// Open-Meteo client. No API key, no account, no quota — which is why it fits
// the self-hosted Quarc model. Three separate upstream services are used:
//   forecast      — current conditions, hourly, daily
//   air-quality   — AQI + pollen (separate host, separate call)
//   geocoding     — city search / reverse lookup
//
// Everything is proxied through this backend rather than called from the
// browser directly, so the APK and desktop app go through one code path and
// responses can be cached server-side for everyone at once.

const cache = require('./cache');

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const FORECAST_TTL = 10 * 60 * 1000; // upstream model refreshes every ~15 min
const AIR_TTL = 30 * 60 * 1000;
const GEOCODE_TTL = 24 * 60 * 60 * 1000; // city coordinates never move

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'surface_pressure',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'visibility',
];

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'uv_index',
  'visibility',
  'is_day',
];

const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'sunrise',
  'sunset',
  'daylight_duration',
  'uv_index_max',
  'precipitation_sum',
  'rain_sum',
  'showers_sum',
  'snowfall_sum',
  'precipitation_hours',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
];

const AIR_CURRENT_FIELDS = [
  'european_aqi',
  'us_aqi',
  'pm10',
  'pm2_5',
  'carbon_monoxide',
  'nitrogen_dioxide',
  'sulphur_dioxide',
  'ozone',
];

const AIR_HOURLY_FIELDS = ['alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'];

function unitParams({ units = 'metric', windUnit = 'kmh', precipUnit = 'mm' } = {}) {
  return {
    temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
    wind_speed_unit: windUnit,
    precipitation_unit: precipUnit,
  };
}

async function getJson(url, params) {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${url}?${qs}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Quarc-Weather/1.0 (self-hosted)' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Open-Meteo ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Full forecast bundle for one coordinate: current + 48h hourly + 10d daily.
 */
async function getForecast(lat, lon, opts = {}) {
  const key = `fc:${lat.toFixed(3)}:${lon.toFixed(3)}:${opts.units}:${opts.windUnit}:${opts.precipUnit}`;
  return cache.through(key, FORECAST_TTL, () =>
    getJson(FORECAST_URL, {
      latitude: lat,
      longitude: lon,
      current: CURRENT_FIELDS.join(','),
      hourly: HOURLY_FIELDS.join(','),
      daily: DAILY_FIELDS.join(','),
      timezone: 'auto',
      forecast_days: 10,
      past_days: 1, // lets the hourly strip show "earlier today" without a second call
      ...unitParams(opts),
    })
  );
}

/**
 * Air quality + pollen. Separate host, so it's a separate call and separate
 * cache entry — a failure here must not take down the main forecast.
 */
async function getAirQuality(lat, lon) {
  const key = `aq:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  return cache.through(key, AIR_TTL, () =>
    getJson(AIR_URL, {
      latitude: lat,
      longitude: lon,
      current: AIR_CURRENT_FIELDS.join(','),
      hourly: AIR_HOURLY_FIELDS.join(','),
      timezone: 'auto',
      forecast_days: 1,
    })
  );
}

/**
 * City search. Open-Meteo's geocoder returns population and admin regions,
 * which we keep so the UI can disambiguate the four different Springfields.
 */
async function searchCities(name, { language = 'en', count = 10 } = {}) {
  const q = name.trim();
  if (q.length < 2) return [];
  const key = `geo:${language}:${q.toLowerCase()}`;
  const data = await cache.through(key, GEOCODE_TTL, () =>
    getJson(GEOCODE_URL, { name: q, count, language, format: 'json' })
  );
  return (data.results || []).map((r) => ({
    name: r.name,
    country: r.country,
    country_code: r.country_code,
    admin1: r.admin1,
    admin2: r.admin2,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    population: r.population,
    elevation: r.elevation,
  }));
}

module.exports = { getForecast, getAirQuality, searchCities };
