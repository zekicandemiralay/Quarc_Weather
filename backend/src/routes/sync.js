// Account sync for Quarc Weather: the list of cities a person added by hand and a
// few settings. Same design as Quarc Calendar's /api/sync (the suite's existing
// answer to "work offline, merge devices later"):
//
//   GET  /api/sync/pull?since=<cursor>   everything this account changed after the cursor, paged
//   POST /api/sync/push                  queued edits from a device, newest edit wins
//
// What is NOT here, on purpose: forecasts (each device asks the weather provider
// itself) and "My Location" (it belongs to one device and never leaves it).

const express = require('express');
const router = express.Router();
const { getDb, nowIso, getEpoch } = require('../db');
const { cityKey } = require('../services/cityKey');

const PAGE_LIMIT = 1000;
const MAX_MUTATIONS = 500;
// A device with a badly wrong clock must not win every conflict from the future.
const FUTURE_SKEW_MS = 5 * 60 * 1000;

// The settings that follow the account, and the values each may hold.
const PREF_FIELDS = {
  units: ['metric', 'imperial'],
  wind_unit: ['kmh', 'ms', 'mph', 'kn'],
  precip_unit: ['mm', 'inch'],
  language: ['en', 'tr'],
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const validIso = (v) => typeof v === 'string' && v.length >= 10 && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Normalises a device timestamp to ISO and caps it at "now + 5 minutes". */
function clampTime(value) {
  const limit = Date.now() + FUTURE_SKEW_MS;
  return new Date(Math.min(Date.parse(value), limit)).toISOString();
}

// --- row shapes sent to devices ---------------------------------------------
function outCity(r) {
  return {
    id: r.id,
    name: r.name,
    country: r.country,
    country_code: r.country_code,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    sort_order: r.sort_order,
    is_deleted: r.is_deleted,
    client_updated_at: r.client_updated_at,
    updated_at: r.updated_at,
    created_at: r.created_at,
  };
}

function outPrefs(r) {
  const fields = {};
  for (const key of Object.keys(PREF_FIELDS)) fields[key] = { value: r[key], t: r[`t_${key}`] };
  return { fields, updated_at: r.updated_at };
}

// --- pull ---------------------------------------------------------------------
// Updated stamps are unique (see nowIso), so cutting a page at a row boundary and
// continuing from that row's stamp can never skip or repeat anything.
router.get('/pull', (req, res) => {
  const db = getDb();
  const since = typeof req.query.since === 'string' ? req.query.since : '';

  const rows = db
    .prepare('SELECT * FROM cities WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT ?')
    .all(req.user.id, since, PAGE_LIMIT + 1);
  const hasMore = rows.length > PAGE_LIMIT;
  const page = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;

  let cursor = page.length ? page[page.length - 1].updated_at : since;

  const prefsRow = db.prepare('SELECT * FROM prefs_sync WHERE user_id = ? AND updated_at > ?').get(req.user.id, since);
  // Settings ride along on every page that follows a change (merging them twice is harmless), but the
  // cursor only passes them once the final page is reached.
  if (prefsRow && !hasMore && prefsRow.updated_at > cursor) cursor = prefsRow.updated_at;

  res.json({
    // Identifies this incarnation of the data: it changes when the server is restored from a backup or rebuilt,
    // which tells devices to re-send everything they hold (see getEpoch in db.js).
    epoch: getEpoch(db),
    cursor,
    hasMore,
    cities: page.map(outCity),
    prefs: prefsRow ? outPrefs(prefsRow) : null,
  });
});

// --- push ---------------------------------------------------------------------
function applyCity(db, userId, m, results) {
  const t = clampTime(m.client_updated_at);
  const existing = db.prepare('SELECT * FROM cities WHERE user_id = ? AND id = ?').get(userId, m.id);

  // Another device already holds a newer edit of this city: hand it back so this
  // device adopts it and the mutation never sits in its queue forever.
  if (existing && existing.client_updated_at > t) {
    results.push({ table: 'cities', id: m.id, status: 'stale', row: outCity(existing) });
    return;
  }

  if (m.op === 'delete') {
    if (existing) {
      db.prepare(
        'UPDATE cities SET is_deleted = 1, client_updated_at = ?, updated_at = ? WHERE user_id = ? AND id = ?'
      ).run(t, nowIso(), userId, m.id);
    }
    results.push({ table: 'cities', id: m.id, status: 'ok' });
    return;
  }

  const d = m.data || {};
  const name = str(d.name, 120)?.trim();
  const lat = d.latitude;
  const lon = d.longitude;
  const sane =
    name &&
    typeof lat === 'number' && typeof lon === 'number' &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
    // The id must BE the coordinates' key: it is what makes the same place one row on every device.
    m.id === cityKey(lat, lon);
  if (!sane) {
    results.push({ table: 'cities', id: m.id, status: 'invalid' });
    return;
  }

  const sortOrder = Number.isFinite(d.sort_order) ? Math.max(-1e12, Math.min(1e12, d.sort_order)) : 0;
  const vals = [
    name, str(d.country, 120), str(d.country_code, 8), str(d.admin1, 120), lat, lon, str(d.timezone, 64), sortOrder,
  ];
  const stamp = nowIso();

  if (existing) {
    db.prepare(
      `UPDATE cities SET name = ?, country = ?, country_code = ?, admin1 = ?, latitude = ?, longitude = ?,
         timezone = ?, sort_order = ?, is_deleted = 0, client_updated_at = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`
    ).run(...vals, t, stamp, userId, m.id);
  } else {
    const created = validIso(d.created_at) ? clampTime(d.created_at) : stamp;
    db.prepare(
      `INSERT INTO cities (user_id, id, name, country, country_code, admin1, latitude, longitude, timezone,
         sort_order, is_deleted, client_updated_at, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(userId, m.id, ...vals, t, stamp, created);
  }
  results.push({ table: 'cities', id: m.id, status: 'ok' });
}

// Settings merge field by field: each field carries its own edit time, and only a
// newer one replaces what is stored. The merged result always goes back to the
// device, which adopts it.
function applyPrefs(db, userId, m, results) {
  const incoming = m.data && typeof m.data.fields === 'object' && m.data.fields ? m.data.fields : null;
  if (!incoming) {
    results.push({ table: 'prefs', id: 'prefs', status: 'invalid' });
    return;
  }

  let row = db.prepare('SELECT * FROM prefs_sync WHERE user_id = ?').get(userId);
  const next = row ? { ...row } : { user_id: userId };
  for (const key of Object.keys(PREF_FIELDS)) {
    next[key] ??= key === 'units' ? 'metric' : key === 'wind_unit' ? 'kmh' : key === 'precip_unit' ? 'mm' : 'en';
    next[`t_${key}`] ??= '';
  }

  let changed = false;
  for (const [key, allowed] of Object.entries(PREF_FIELDS)) {
    const f = incoming[key];
    if (!f || !allowed.includes(f.value) || !validIso(f.t)) continue;
    const t = clampTime(f.t);
    if (t > next[`t_${key}`]) {
      next[key] = f.value;
      next[`t_${key}`] = t;
      changed = true;
    }
  }

  if (changed || !row) {
    next.updated_at = nowIso();
    db.prepare(
      `INSERT INTO prefs_sync
         (user_id, units, t_units, wind_unit, t_wind_unit, precip_unit, t_precip_unit, language, t_language, updated_at)
       VALUES (@user_id, @units, @t_units, @wind_unit, @t_wind_unit, @precip_unit, @t_precip_unit, @language, @t_language, @updated_at)
       ON CONFLICT(user_id) DO UPDATE SET
         units = @units, t_units = @t_units, wind_unit = @wind_unit, t_wind_unit = @t_wind_unit,
         precip_unit = @precip_unit, t_precip_unit = @t_precip_unit, language = @language, t_language = @t_language,
         updated_at = @updated_at`
    ).run(next);
    row = next;
  }
  results.push({ table: 'prefs', id: 'prefs', status: 'ok', row: outPrefs(row) });
}

router.post('/push', (req, res) => {
  const db = getDb();
  const mutations = Array.isArray(req.body?.mutations) ? req.body.mutations.slice(0, MAX_MUTATIONS) : [];
  const results = [];

  db.transaction(() => {
    for (const m of mutations) {
      if (m && m.table === 'prefs' && m.id === 'prefs') {
        applyPrefs(db, req.user.id, m, results);
        continue;
      }
      if (!m || m.table !== 'cities' || typeof m.id !== 'string' || m.id.length > 64 || !validIso(m.client_updated_at)) {
        results.push({ table: m?.table, id: m?.id, status: 'invalid' });
        continue;
      }
      if (m.op !== 'upsert' && m.op !== 'delete') {
        results.push({ table: 'cities', id: m.id, status: 'invalid' });
        continue;
      }
      applyCity(db, req.user.id, m, results);
    }
  })();

  res.json({ results });
});

module.exports = router;
