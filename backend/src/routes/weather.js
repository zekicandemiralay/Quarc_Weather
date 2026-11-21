const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getForecast, getAirQuality } = require('../services/openMeteo');
const { moonPhase } = require('../services/astronomy');
const { computeAlerts } = require('../services/alerts');
const { currentHourWallClock } = require('../services/wallclock');

function unitOpts(req) {
  const row = getDb().prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id);
  return {
    units: row?.units || 'metric',
    windUnit: row?.wind_unit || 'kmh',
    precipUnit: row?.precip_unit || 'mm',
  };
}

/**
 * GET /api/weather?city=<id>   (preferred — one round trip, no client-side lookup)
 * GET /api/weather?lat=&lon=
 * The full bundle behind one city screen. Air quality is fetched alongside
 * but never allowed to fail the request — a missing AQI panel is far better
 * than a blank screen.
 *
 * With `city`, the saved city row is resolved here and returned as `city`, so
 * the client doesn't have to fetch the whole city list before it can ask for
 * the forecast (and can render offline from one cached payload).
 * `refresh=1` is pull-to-refresh: bypass the cache, rate-limited server-side.
 */
router.get('/', async (req, res) => {
  let lat;
  let lon;
  let city = null;

  if (req.query.city) {
    city = getDb()
      .prepare('SELECT * FROM cities WHERE id = ? AND user_id = ?')
      .get(String(req.query.city), req.user.id);
    if (!city) return res.status(404).json({ error: 'City not found' });
    lat = city.latitude;
    lon = city.longitude;
  } else {
    lat = Number(req.query.lat);
    lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'lat and lon (or city) are required' });
    }
  }

  const opts = unitOpts(req);
  const force = req.query.refresh === '1';

  try {
    const [forecast, air] = await Promise.all([
      getForecast(lat, lon, opts, { force }),
      getAirQuality(lat, lon).catch(() => null),
    ]);

    res.json({
      ...forecast,
      ...(city ? { city } : {}),
      air_quality: air,
      moon: moonPhase(),
      alerts: computeAlerts(forecast, forecast.timezone),
      units_preference: opts,
    });
  } catch (err) {
    res.status(502).json({ error: 'Forecast unavailable', detail: err.message });
  }
});

/**
 * Slices N upcoming hours out of an already-fetched hourly block, starting
 * from "now" in the city's own timezone — the same rule the frontend hourly
 * strip uses, so a widget or any other compact consumer sees the same "now"
 * cell the full app does. forecast_days requests past_days=1, so index 0 of
 * hourly.time is yesterday's midnight, not "now" — this can't just start at 0.
 */
function nextHours(hourly, count, timezone) {
  if (!hourly?.time?.length) return [];
  const nowHour = currentHourWallClock(timezone);
  const start = Math.max(0, hourly.time.findIndex((iso) => !nowHour || iso >= nowHour));
  return hourly.time.slice(start, start + count).map((time, i) => ({
    time,
    weather_code: hourly.weather_code?.[start + i],
    temperature_2m: hourly.temperature_2m?.[start + i],
    is_day: hourly.is_day?.[start + i],
  }));
}

/**
 * GET /api/weather/overview
 * Current conditions for every saved city at once, so the city list can render
 * in a single round trip instead of one request per row. Also carries a short
 * next_hours slice per city — small enough to be free to include, and it's
 * what lets a compact consumer like the Android widget show a short hourly
 * strip without a second request.
 */
router.get('/overview', async (req, res) => {
  const cities = getDb()
    .prepare('SELECT * FROM cities WHERE user_id = ? ORDER BY is_current_location DESC, sort_order ASC, created_at ASC')
    .all(req.user.id);

  if (cities.length === 0) return res.json([]);

  const opts = unitOpts(req);

  const results = await Promise.all(
    cities.map(async (city) => {
      try {
        const fc = await getForecast(city.latitude, city.longitude, opts);
        const timezone = fc.timezone || city.timezone;
        return {
          ...city,
          current: fc.current,
          current_units: fc.current_units,
          next_hours: nextHours(fc.hourly, 6, timezone),
          today: fc.daily
            ? {
                weather_code: fc.daily.weather_code?.[1],
                temperature_2m_max: fc.daily.temperature_2m_max?.[1],
                temperature_2m_min: fc.daily.temperature_2m_min?.[1],
                sunrise: fc.daily.sunrise?.[1],
                sunset: fc.daily.sunset?.[1],
              }
            : null,
          timezone,
          error: null,
        };
      } catch (err) {
        // One unreachable city must not blank the whole list.
        return { ...city, current: null, next_hours: [], today: null, error: err.message };
      }
    })
  );

  res.json(results);
});

module.exports = router;
