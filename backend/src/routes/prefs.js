const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

const DEFAULTS = { units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', theme: 'auto', language: 'en' };

const ALLOWED = {
  units: ['metric', 'imperial'],
  wind_unit: ['kmh', 'ms', 'mph', 'kn'],
  precip_unit: ['mm', 'inch'],
  theme: ['auto', 'light', 'dark'],
  language: ['en', 'tr'],
};

router.get('/', (req, res) => {
  const row = getDb().prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id);
  res.json(row ? { ...DEFAULTS, ...row } : { user_id: req.user.id, ...DEFAULTS });
});

router.put('/', (req, res) => {
  const patch = {};
  for (const [key, values] of Object.entries(ALLOWED)) {
    const incoming = req.body?.[key];
    if (incoming === undefined) continue;
    if (!values.includes(incoming)) {
      return res.status(400).json({ error: `${key} must be one of: ${values.join(', ')}` });
    }
    patch[key] = incoming;
  }

  const db = getDb();
  const current = db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id) || DEFAULTS;
  const merged = { ...DEFAULTS, ...current, ...patch, user_id: req.user.id };

  db.prepare(
    `INSERT INTO prefs (user_id, units, wind_unit, precip_unit, theme, language, updated_at)
     VALUES (@user_id, @units, @wind_unit, @precip_unit, @theme, @language, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       units = @units, wind_unit = @wind_unit, precip_unit = @precip_unit,
       theme = @theme, language = @language, updated_at = datetime('now')`
  ).run(merged);

  res.json(db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id));
});

module.exports = router;
