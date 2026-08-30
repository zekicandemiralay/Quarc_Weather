const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

const DEFAULTS = {
  units: 'metric',
  wind_unit: 'kmh',
  precip_unit: 'mm',
  theme: 'auto',
  language: 'en',
  daily_briefing_enabled: 0,
  daily_briefing_hour: 8,
  daily_briefing_minute: 0,
};

const ALLOWED = {
  units: ['metric', 'imperial'],
  wind_unit: ['kmh', 'ms', 'mph', 'kn'],
  precip_unit: ['mm', 'inch'],
  theme: ['auto', 'light', 'dark'],
  language: ['en', 'tr'],
};

// Validated by range rather than a fixed list — see ALLOWED above for the
// enum-style fields.
const RANGED = {
  daily_briefing_hour: { min: 0, max: 23 },
  daily_briefing_minute: { min: 0, max: 59 },
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

  for (const [key, { min, max }] of Object.entries(RANGED)) {
    const incoming = req.body?.[key];
    if (incoming === undefined) continue;
    const n = Number(incoming);
    if (!Number.isInteger(n) || n < min || n > max) {
      return res.status(400).json({ error: `${key} must be an integer between ${min} and ${max}` });
    }
    patch[key] = n;
  }

  if (req.body?.daily_briefing_enabled !== undefined) {
    patch.daily_briefing_enabled = req.body.daily_briefing_enabled ? 1 : 0;
  }

  const db = getDb();
  const current = db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id) || DEFAULTS;
  const merged = { ...DEFAULTS, ...current, ...patch, user_id: req.user.id };

  db.prepare(
    `INSERT INTO prefs (
       user_id, units, wind_unit, precip_unit, theme, language,
       daily_briefing_enabled, daily_briefing_hour, daily_briefing_minute, updated_at
     )
     VALUES (
       @user_id, @units, @wind_unit, @precip_unit, @theme, @language,
       @daily_briefing_enabled, @daily_briefing_hour, @daily_briefing_minute, datetime('now')
     )
     ON CONFLICT(user_id) DO UPDATE SET
       units = @units, wind_unit = @wind_unit, precip_unit = @precip_unit,
       theme = @theme, language = @language,
       daily_briefing_enabled = @daily_briefing_enabled,
       daily_briefing_hour = @daily_briefing_hour,
       daily_briefing_minute = @daily_briefing_minute,
       updated_at = datetime('now')`
  ).run(merged);

  res.json(db.prepare('SELECT * FROM prefs WHERE user_id = ?').get(req.user.id));
});

module.exports = router;
