const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { cityKey } = require('./services/cityKey');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'weather.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// --- time ---------------------------------------------------------------------
// `updated_at` is the cursor devices use to ask "what changed since I last
// looked?". If two writes got the same millisecond, a device that pulled in
// between could skip the second one forever — so every stamp handed out is
// strictly greater than the previous one, even within the same millisecond.
let lastStampMs = 0;
function nowIso() {
  const ms = Math.max(Date.now(), lastStampMs + 1);
  lastStampMs = ms;
  return new Date(ms).toISOString();
}

// SQLite's datetime('now') looks like "2026-08-30 14:05:12" (UTC, no zone marker).
const legacyToIso = (s) => (s ? `${String(s).replace(' ', 'T')}Z` : new Date(0).toISOString());

// --- schema -------------------------------------------------------------------
//
// What the server stores now is only what has to follow an ACCOUNT between
// devices: the list of cities a person added by hand, and a few settings. It
// holds no weather and no location — each device gets its own forecast
// straight from the weather provider, and "My Location" never leaves the device.
//
// Both tables are synced like Quarc Calendar's: rows are never really deleted
// (a deletion is a tombstone so other devices learn of it), every change bumps
// `updated_at`, and the newest edit by `client_updated_at` wins.

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cities (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,                       -- cityKey(latitude, longitude)
    name TEXT NOT NULL,
    country TEXT,
    country_code TEXT,
    admin1 TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    timezone TEXT,
    sort_order REAL NOT NULL DEFAULT 0,     -- fractional, so two devices can reorder different cities and merge
    is_deleted INTEGER NOT NULL DEFAULT 0,
    client_updated_at TEXT NOT NULL,        -- the editing device's clock: decides who wins a conflict
    updated_at TEXT NOT NULL,               -- this server's stamp: the sync cursor
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_cities_user_updated ON cities(user_id, updated_at);

  -- Settings that follow the account. Each has its own edit time, so changing
  -- units on one device and the language on another keeps BOTH changes.
  -- (Theme and the daily-briefing schedule are per-device and are not stored here.)
  CREATE TABLE IF NOT EXISTS prefs_sync (
    user_id TEXT PRIMARY KEY,
    units TEXT NOT NULL DEFAULT 'metric',
    t_units TEXT NOT NULL DEFAULT '',
    wind_unit TEXT NOT NULL DEFAULT 'kmh',
    t_wind_unit TEXT NOT NULL DEFAULT '',
    precip_unit TEXT NOT NULL DEFAULT 'mm',
    t_precip_unit TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'en',
    t_language TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
`;

function tableExists(database, name) {
  return !!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnExists(database, table, column) {
  return database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

/**
 * One-time conversion of the old per-server city list (random uuid ids, a
 * server-side "My Location" pin per user, settings in `prefs`) to the synced
 * schema. Idempotent: it only runs when it finds the old `cities` table.
 *
 *  - ids become cityKey(lat, lon); two old rows for the same place collapse to one
 *  - old "My Location" pins are dropped (that is per-device data now)
 *  - the old `prefs` table is left in place, untouched, as a record
 *  - a full copy of the database is written first (VACUUM INTO) so nothing is unrecoverable
 */
function migrateLegacy(database, dbPath) {
  if (dbPath && dbPath !== ':memory:') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(path.dirname(dbPath), `${path.basename(dbPath)}.before-sync-${stamp}`);
    database.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  }

  const run = database.transaction(() => {
    database.exec('ALTER TABLE cities RENAME TO cities_legacy');
    database.exec(SCHEMA_SQL);

    const insert = database.prepare(
      `INSERT OR IGNORE INTO cities
         (user_id, id, name, country, country_code, admin1, latitude, longitude, timezone,
          sort_order, is_deleted, client_updated_at, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    );
    const legacyRows = database
      .prepare('SELECT * FROM cities_legacy WHERE COALESCE(is_current_location, 0) = 0 ORDER BY user_id, sort_order, created_at')
      .all();
    legacyRows.forEach((r) => {
      const created = legacyToIso(r.created_at);
      insert.run(
        r.user_id, cityKey(r.latitude, r.longitude), r.name, r.country, r.country_code, r.admin1,
        r.latitude, r.longitude, r.timezone, Number(r.sort_order) || 0,
        created, nowIso(), created
      );
    });
    database.exec('DROP TABLE cities_legacy');

    if (tableExists(database, 'prefs')) {
      const insertPrefs = database.prepare(
        `INSERT OR IGNORE INTO prefs_sync
           (user_id, units, t_units, wind_unit, t_wind_unit, precip_unit, t_precip_unit, language, t_language, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of database.prepare('SELECT * FROM prefs').all()) {
        const t = legacyToIso(p.updated_at);
        insertPrefs.run(
          p.user_id,
          p.units || 'metric', t, p.wind_unit || 'kmh', t, p.precip_unit || 'mm', t, p.language || 'en', t,
          nowIso()
        );
      }
    }
  });
  run();
}

function migrate(database, dbPath) {
  const legacy = tableExists(database, 'cities') && !columnExists(database, 'cities', 'is_deleted');
  if (legacy) migrateLegacy(database, dbPath);
  else database.exec(SCHEMA_SQL);
}

function initDb() {
  migrate(getDb(), DB_PATH);
}

module.exports = { getDb, initDb, migrate, nowIso, SCHEMA_SQL };
