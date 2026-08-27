import { apiUrl } from './apiUrl';

async function request(path, options = {}) {
  const res = await fetch(apiUrl(path), { credentials: 'include', ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function json(method, path, body) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Cities -------------------------------------------------------------
export const listCities = () => request('/api/cities');
export const addCity = (city) => json('POST', '/api/cities', city);
export const deleteCity = (id) => request(`/api/cities/${id}`, { method: 'DELETE' });
export const reorderCities = (ids) => json('PUT', '/api/cities/reorder', { ids });

// --- Weather ------------------------------------------------------------
export const getWeather = (lat, lon) => request(`/api/weather?lat=${lat}&lon=${lon}`);
export const getOverview = () => request('/api/weather/overview');

// --- Geocoding ----------------------------------------------------------
export const searchCities = (q, lang = 'en') =>
  request(`/api/geocode/search?q=${encodeURIComponent(q)}&lang=${lang}`);

// --- Preferences --------------------------------------------------------
export const getPrefs = () => request('/api/prefs');
export const savePrefs = (patch) => json('PUT', '/api/prefs', patch);

// --- Offline cache ------------------------------------------------------
// The APK and the PWA both get opened in places with no signal. Every
// successful forecast is mirrored to localStorage so a reopen shows the last
// known conditions with a clear "as of" timestamp instead of an error page.

const CACHE_KEY = 'quarc_weather_cache';

export function cacheWeather(cityId, data) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    all[cityId] = { data, at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* quota exceeded or private mode — caching is a bonus, never required */
  }
}

export function readCachedWeather(cityId) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return all[cityId] || null;
  } catch {
    return null;
  }
}
