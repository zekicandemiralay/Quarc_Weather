// Talks to the weather providers DIRECTLY from the device — no Quarc server in the path. That is what lets
// the app work when Tailscale is off (or the server is down): Open-Meteo, its geocoder and OpenStreetMap's
// Nominatim all answer browsers (CORS allows any origin) and none needs an API key.
//
//   forecast / air quality   Open-Meteo        free for non-commercial use, 600 requests/min per IP
//   city search              Open-Meteo geocoder
//   place name for a point   Nominatim         ("Cankurtaran" rather than "41.008, 28.978")
//
// No custom request headers on purpose: any non-simple header forces a CORS pre-flight round trip, and a
// browser ignores a User-Agent anyway. Plain GETs only.

import { computeAlerts } from './computeAlerts.js';
import { moonPhase } from './astronomy.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

const TIMEOUT_MS = 12000;

const CURRENT_FIELDS = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day', 'precipitation', 'rain', 'showers',
  'snowfall', 'weather_code', 'cloud_cover', 'pressure_msl', 'surface_pressure', 'wind_speed_10m',
  'wind_direction_10m', 'wind_gusts_10m', 'visibility',
];

const HOURLY_FIELDS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation_probability', 'precipitation',
  'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'uv_index', 'visibility', 'is_day',
];

const DAILY_FIELDS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max', 'apparent_temperature_min',
  'sunrise', 'sunset', 'daylight_duration', 'uv_index_max', 'precipitation_sum', 'rain_sum', 'showers_sum',
  'snowfall_sum', 'precipitation_hours', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
];

const AIR_CURRENT_FIELDS = [
  'european_aqi', 'us_aqi', 'pm10', 'pm2_5', 'carbon_monoxide', 'nitrogen_dioxide', 'sulphur_dioxide', 'ozone',
];
const AIR_HOURLY_FIELDS = ['alder_pollen', 'birch_pollen', 'grass_pollen', 'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'];

/** The three unit settings, as the provider spells them. */
function unitParams({ units = 'metric', wind_unit = 'kmh', precip_unit = 'mm' } = {}) {
  return {
    temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
    wind_speed_unit: wind_unit,
    precipitation_unit: precip_unit,
  };
}

export class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

async function getJson(url, params, fetchImpl = fetch) {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${url}?${qs}`, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderError(`Weather service ${res.status}: ${body.slice(0, 160)}`, res.status);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(err?.name === 'AbortError' ? 'Weather service timed out' : 'Weather service unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Current + 48 h hourly + 10 d daily for one coordinate, in the user's units.
 * `past_days=1` lets the hourly strip show "earlier today" without a second call (and is why today is index 1).
 */
export function fetchForecast(lat, lon, prefs, fetchImpl) {
  return getJson(
    FORECAST_URL,
    {
      latitude: lat,
      longitude: lon,
      current: CURRENT_FIELDS.join(','),
      hourly: HOURLY_FIELDS.join(','),
      daily: DAILY_FIELDS.join(','),
      timezone: 'auto',
      forecast_days: 10,
      past_days: 1,
      ...unitParams(prefs),
    },
    fetchImpl
  );
}

/** Air quality + pollen — a separate host, so a failure here must never take down the forecast. */
export function fetchAirQuality(lat, lon, fetchImpl) {
  return getJson(
    AIR_URL,
    {
      latitude: lat,
      longitude: lon,
      current: AIR_CURRENT_FIELDS.join(','),
      hourly: AIR_HOURLY_FIELDS.join(','),
      timezone: 'auto',
      forecast_days: 1,
    },
    fetchImpl
  );
}

/**
 * Everything one city screen needs, assembled the way the old server did, so the screens are unchanged:
 * the forecast, air quality (null if unavailable), moon phase and the heads-up alerts.
 */
export async function fetchBundle(lat, lon, prefs, { fetchImpl, now = new Date() } = {}) {
  const [forecast, air] = await Promise.all([
    fetchForecast(lat, lon, prefs, fetchImpl),
    fetchAirQuality(lat, lon, fetchImpl).catch(() => null),
  ]);
  return {
    ...forecast,
    fetched_at: now.getTime(),
    air_quality: air,
    moon: moonPhase(now),
    alerts: computeAlerts(forecast, forecast.timezone, now),
    units_preference: { units: prefs.units, windUnit: prefs.wind_unit, precipUnit: prefs.precip_unit },
  };
}

/**
 * City search. Open-Meteo's geocoder returns population and admin regions, which the UI uses to tell the
 * four different Springfields apart.
 */
export async function searchPlaces(name, { language = 'en', count = 10, fetchImpl } = {}) {
  const q = String(name || '').trim();
  if (q.length < 2) return [];
  const data = await getJson(GEOCODE_URL, { name: q, count, language, format: 'json' }, fetchImpl);
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

/**
 * A real place name for a GPS fix ("Cankurtaran, İstanbul"). Nominatim's usage policy asks for at most ~1
 * request per second, which is trivially met: this runs once when the position actually changes.
 * Resolves null for anything that can't be named (open ocean, offline, an error) — callers fall back to a
 * plain coordinate label, and a failed lookup never blocks anything.
 */
export async function reverseGeocode(lat, lon, { language = 'en', fetchImpl } = {}) {
  try {
    const a = await getJson(
      REVERSE_URL,
      {
        lat: lat.toFixed(5),
        lon: lon.toFixed(5),
        format: 'jsonv2',
        zoom: '14', // suburb/neighbourhood level — "nearest named place", not a street address
        addressdetails: '1',
        'accept-language': language,
      },
      fetchImpl
    );
    if (a.error) return null; // e.g. a coordinate out in open ocean
    const ad = a.address || {};
    // Nearest-to-furthest: prefer a neighbourhood/suburb over the whole city when one exists.
    const name =
      ad.suburb || ad.neighbourhood || ad.quarter || ad.town || ad.village || ad.city_district || ad.city || ad.county || a.name || null;
    if (!name) return null;
    return { name, admin1: ad.state || ad.province || ad.region || ad.county || null, country: ad.country || null };
  } catch {
    return null;
  }
}
