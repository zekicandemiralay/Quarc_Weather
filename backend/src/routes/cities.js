const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

// GET /api/cities — the signed-in user's saved list, in their chosen order.
router.get('/', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM cities WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(req.user.id);
  res.json(rows);
});

// POST /api/cities — save a city from a geocoder result.
router.post('/', (req, res) => {
  const { name, country, country_code, admin1, latitude, longitude, timezone, is_current_location } = req.body || {};

  if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'name, latitude and longitude are required' });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Coordinates out of range' });
  }

  const db = getDb();
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM cities WHERE user_id = ?')
    .get(req.user.id);

  const city = {
    id: uuidv4(),
    user_id: req.user.id,
    name: String(name).slice(0, 120),
    country: country ? String(country).slice(0, 120) : null,
    country_code: country_code ? String(country_code).slice(0, 8) : null,
    admin1: admin1 ? String(admin1).slice(0, 120) : null,
    latitude,
    longitude,
    timezone: timezone ? String(timezone).slice(0, 64) : null,
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
});

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
