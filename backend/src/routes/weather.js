const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getForecast, getAirQuality } = require('../services/openMeteo');
const { moonPhase } = require('../services/astronomy');

function unitOpts(req) {
  const row = getDb().prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id);
  return {
    units: row?.units || 'metric',
    windUnit: row?.wind_unit || 'kmh',
    precipUnit: row?.precip_unit || 'mm',
  };
}

/**
 * GET /api/weather?lat=&lon=
 * The full bundle behind one city screen. Air quality is fetched alongside
 * but never allowed to fail the request — a missing AQI panel is far better
 * than a blank screen.
 */
router.get('/', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const opts = unitOpts(req);

  try {
    const [forecast, air] = await Promise.all([
      getForecast(lat, lon, opts),
      getAirQuality(lat, lon).catch(() => null),
    ]);

    res.json({
      ...forecast,
      air_quality: air,
      moon: moonPhase(),
      units_preference: opts,
    });
  } catch (err) {
    res.status(502).json({ error: 'Forecast unavailable', detail: err.message });
  }
});

/**
 * GET /api/weather/overview
 * Current conditions for every saved city at once, so the city list can render
 * in a single round trip instead of one request per row.
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
        return {
          ...city,
          current: fc.current,
          current_units: fc.current_units,
          today: fc.daily
            ? {
                weather_code: fc.daily.weather_code?.[1],
                temperature_2m_max: fc.daily.temperature_2m_max?.[1],
                temperature_2m_min: fc.daily.temperature_2m_min?.[1],
                sunrise: fc.daily.sunrise?.[1],
                sunset: fc.daily.sunset?.[1],
              }
            : null,
          timezone: fc.timezone || city.timezone,
          error: null,
        };
      } catch (err) {
        // One unreachable city must not blank the whole list.
        return { ...city, current: null, today: null, error: err.message };
      }
    })
  );

  res.json(results);
});

module.exports = router;
