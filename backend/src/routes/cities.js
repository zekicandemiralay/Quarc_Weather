const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { reverseGeocode } = require('../services/reverseGeocode');

// GET /api/cities — the signed-in user's saved list. My Location, if present,
// is always pinned first regardless of manual sort order — the app's landing
// screen and the city list both rely on that ordering.
router.get('/', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM cities WHERE user_id = ? ORDER BY is_current_location DESC, sort_order ASC, created_at ASC')
    .all(req.user.id);
  res.json(rows);
});

// POST /api/cities — save a city from a geocoder result, or move the user's
// live-location pin to a new position.
//
// Wrapped in try/catch and forwarded to next(err): this handler is async
// (the reverse-geocode lookup needs to be awaited), and unlike a synchronous
// handler, Express 4 does not automatically catch a rejected promise or a
// throw inside one — without this, an unexpected DB error below would hang
// the request instead of reaching the error middleware in index.js.
router.post('/', async (req, res, next) => {
  try {
    await handleSaveCity(req, res);
  } catch (err) {
    next(err);
  }
});

async function handleSaveCity(req, res) {
  const { name, country, country_code, admin1, latitude, longitude, timezone, is_current_location, language } =
    req.body || {};

  if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'name, latitude and longitude are required' });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Coordinates out of range' });
  }

  const db = getDb();
  const fields = {
    name: String(name).slice(0, 120),
    country: country ? String(country).slice(0, 120) : null,
    country_code: country_code ? String(country_code).slice(0, 8) : null,
    admin1: admin1 ? String(admin1).slice(0, 120) : null,
    latitude,
    longitude,
    timezone: timezone ? String(timezone).slice(0, 64) : null,
  };

  // The frontend sends bare coordinates as a placeholder name for a live
  // location — resolve a real nearest-place name here instead. Never lets a
  // failed lookup (offline, upstream down) block saving the pin; the
  // coordinate placeholder stands in when that happens.
  if (is_current_location) {
    const resolved = await reverseGeocode(latitude, longitude, { language: language || 'en' });
    if (resolved) {
      fields.name = resolved.name.slice(0, 120);
      fields.admin1 = resolved.admin1 ? resolved.admin1.slice(0, 120) : null;
      fields.country = resolved.country ? resolved.country.slice(0, 120) : fields.country;
    }
  }

  // There is at most one "My Location" row per user. Update it in place
  // instead of inserting a new one each time — otherwise every app open in a
  // new spot (or every trip) would leave a trail of stale live-location pins
  // behind rather than moving the one pin that represents "here, now".
  if (is_current_location) {
    const existing = db
      .prepare('SELECT * FROM cities WHERE user_id = ? AND is_current_location = 1')
      .get(req.user.id);

    if (existing) {
      try {
        db.prepare(
          `UPDATE cities SET name=@name, country=@country, country_code=@country_code, admin1=@admin1,
             latitude=@latitude, longitude=@longitude, timezone=@timezone WHERE id=@id`
        ).run({ ...fields, id: existing.id });
        return res.json(db.prepare('SELECT * FROM cities WHERE id = ?').get(existing.id));
      } catch (err) {
        if (!String(err.message).includes('UNIQUE')) throw err;
        // The new position rounds to coordinates already saved as a regular
        // city (e.g. standing exactly where "Istanbul" is pinned). Drop the
        // separate live pin — showing the real saved city is better than a
        // near-duplicate "My Location" card right next to it.
        db.prepare('DELETE FROM cities WHERE id = ?').run(existing.id);
        const collision = db
          .prepare('SELECT * FROM cities WHERE user_id = ? AND ROUND(latitude,2) = ROUND(?,2) AND ROUND(longitude,2) = ROUND(?,2)')
          .get(req.user.id, latitude, longitude);
        return res.json(collision);
      }
    }
    // else: first time ever — fall through to the normal insert below.
  }

  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM cities WHERE user_id = ?')
    .get(req.user.id);

  const city = {
    id: uuidv4(),
    user_id: req.user.id,
    ...fields,
    is_current_location: is_current_location ? 1 : 0,
    sort_order: max.m + 1,
  };

  try {
    db.prepare(
      `INSERT INTO cities (id, user_id, name, country, country_code, admin1, latitude, longitude, timezone, is_current_location, sort_order)
       VALUES (@id, @user_id, @name, @country, @country_code, @admin1, @latitude, @longitude, @timezone, @is_current_location, @sort_order)`
    ).run(city);
  } catch (err) {
    // The unique index on rounded coordinates rejects a duplicate save.
    if (String(err.message).includes('UNIQUE')) {
      const existing = db
        .prepare('SELECT * FROM cities WHERE user_id = ? AND ROUND(latitude,2) = ROUND(?,2) AND ROUND(longitude,2) = ROUND(?,2)')
        .get(req.user.id, latitude, longitude);
      return res.status(200).json(existing);
    }
    throw err;
  }

  res.status(201).json(db.prepare('SELECT * FROM cities WHERE id = ?').get(city.id));
}

// DELETE /api/cities/:id
router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM cities WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'City not found' });
  res.json({ ok: true });
});

// PUT /api/cities/reorder — body: { ids: [...] } in the new display order.
router.put('/reorder', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });

  const db = getDb();
  const stmt = db.prepare('UPDATE cities SET sort_order = ? WHERE id = ? AND user_id = ?');
  const run = db.transaction((list) => {
    list.forEach((id, i) => stmt.run(i, id, req.user.id));
  });
  run(ids);

  res.json({ ok: true });
});

module.exports = router;
