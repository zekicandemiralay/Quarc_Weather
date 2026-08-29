// Reverse geocoding for the current-location pin — turns raw GPS coordinates
// into a real place name ("Cankurtaran, İstanbul" rather than "41.008,
// 28.978"). Open-Meteo has no reverse endpoint (confirmed against the live
// API), so this uses OpenStreetMap Nominatim instead: free, no API key,
// same self-hosted-friendly profile as everything else this app depends on.
//
// Nominatim's usage policy caps public-instance traffic at ~1 request/second
// and requires a real User-Agent — trivially satisfied here since this is
// only ever called once per app-open per user, and results are cached
// aggressively (a place's name doesn't change day to day).

const cache = require('./cache');

const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const REVERSE_TTL = 24 * 60 * 60 * 1000;

/**
 * @returns {Promise<{name: string, admin1: string|null, country: string|null}|null>}
 *   null if nothing could be resolved (offline, remote ocean coordinate,
 *   upstream error) — callers should fall back to a plain coordinate label.
 */
async function reverseGeocode(lat, lon, { language = 'en' } = {}) {
  const key = `rev:${language}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cache.through(key, REVERSE_TTL, async () => {
    const qs = new URLSearchParams({
      lat: lat.toFixed(5),
      lon: lon.toFixed(5),
      format: 'jsonv2',
      zoom: '14', // suburb/neighbourhood level — "nearest named place", not a street address
      addressdetails: '1',
      'accept-language': language,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${REVERSE_URL}?${qs}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Quarc-Weather/1.0 (self-hosted personal weather app)' },
      });
      if (!res.ok) return null;

      const data = await res.json();
      if (data.error) return null; // e.g. a coordinate out in open ocean

      const a = data.address || {};
      // Nearest-to-furthest: prefer a neighbourhood/suburb over the whole
      // city when one exists, but always fall through to *something*.
      const name = a.suburb || a.neighbourhood || a.quarter || a.town || a.village
        || a.city_district || a.city || a.county || data.name || null;
      const admin1 = a.state || a.province || a.region || a.county || null;
      const country = a.country || null;

      if (!name) return null;
      return { name, admin1, country };
    } catch {
      return null; // timeout, network error, malformed response — never fatal
    } finally {
      clearTimeout(timeout);
    }
  });
}

module.exports = { reverseGeocode };
