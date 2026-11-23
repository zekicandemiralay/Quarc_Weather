// Gets a city's forecast: from the local cache when it is fresh, from the weather provider when it is not, and —
// if the provider cannot be reached — from the last good copy, flagged as stale. Callers never have to care which.
//
// The cache is keyed per city ('here' for My Location) and remembers which units it was fetched in and for which
// coordinates, so changing units or moving to a new place never serves the wrong data.

const FRESH_MS = 10 * 60 * 1000; // the provider's model only refreshes every ~15 minutes
const FORCE_MIN_MS = 30 * 1000; // pull-to-refresh can't hammer the provider

export function createForecastService(db, { fetchBundle, getPrefs, now = () => Date.now() }) {
  const inflight = new Map();

  const signature = (prefs) => `${prefs.units}|${prefs.wind_unit}|${prefs.precip_unit}`;

  /**
   * @param city   { id, latitude, longitude }
   * @param force  true for an explicit refresh (still rate-limited to once per 30 s per city)
   * @returns {Promise<{ data, stale: boolean, at: number }>}  `at` = when `data` was fetched (ms).
   *          Rejects only when there is nothing to show at all.
   */
  async function get(city, { force = false } = {}) {
    const prefs = await getPrefs();
    const sig = signature(prefs);
    const cached = await db.forecasts.get(city.id);
    const usable = cached && cached.sig === sig && cached.lat === city.latitude && cached.lon === city.longitude;
    const age = usable ? now() - cached.at : Infinity;

    if (usable && age < (force ? FORCE_MIN_MS : FRESH_MS)) {
      return { data: cached.data, stale: false, at: cached.at };
    }

    // Two screens asking for the same city at once share one request.
    const flightKey = `${city.id}|${sig}|${city.latitude}|${city.longitude}`;
    if (inflight.has(flightKey)) return inflight.get(flightKey);

    const run = (async () => {
      try {
        const data = await fetchBundle(city.latitude, city.longitude, prefs);
        const at = now();
        await db.forecasts.put({ key: city.id, data, at, sig, lat: city.latitude, lon: city.longitude });
        return { data, stale: false, at };
      } catch (err) {
        if (usable) return { data: cached.data, stale: true, at: cached.at, error: err };
        throw err;
      } finally {
        inflight.delete(flightKey);
      }
    })();
    inflight.set(flightKey, run);
    return run;
  }

  /** The last cached forecast for a city regardless of age (used to paint instantly), or null. */
  async function peek(city) {
    const cached = await db.forecasts.get(city.id);
    return cached && cached.lat === city.latitude && cached.lon === city.longitude ? { data: cached.data, at: cached.at } : null;
  }

  return { get, peek };
}
