const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

function initDb() {
  const database = getDb();

  database.exec(`
    -- One row per city a user has saved. user_id comes from the shared
    -- quarc-auth JWT, so a city list follows the account across every device.
    CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      country TEXT,
      country_code TEXT,
      admin1 TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      timezone TEXT,
      is_current_location INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cities_user ON cities(user_id, sort_order);

    -- A user can't save the same coordinates twice. Rounded to ~1km so two
    -- geocoder hits for the same town don't both get stored.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_unique
      ON cities(user_id, ROUND(latitude, 2), ROUND(longitude, 2));

    CREATE TABLE IF NOT EXISTS prefs (
      user_id TEXT PRIMARY KEY,
      units TEXT NOT NULL DEFAULT 'metric',
      wind_unit TEXT NOT NULL DEFAULT 'kmh',
      precip_unit TEXT NOT NULL DEFAULT 'mm',
      theme TEXT NOT NULL DEFAULT 'auto',
      language TEXT NOT NULL DEFAULT 'en',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // CREATE TABLE IF NOT EXISTS is a no-op on an already-existing table, so
  // new prefs columns added after the table's first release need an actual
  // migration — each ALTER TABLE run on its own and swallowed individually
  // (not batched into one exec) so an already-applied migration on a
  // returning install doesn't abort the ones after it.
  const addColumn = (name, ddl) => {
    try {
      database.exec(`ALTER TABLE prefs ADD COLUMN ${name} ${ddl}`);
    } catch (err) {
      if (!/duplicate column name/i.test(err.message)) throw err;
    }
  };
  addColumn('daily_briefing_enabled', "INTEGER NOT NULL DEFAULT 0");
  addColumn('daily_briefing_hour', "INTEGER NOT NULL DEFAULT 8");
  addColumn('daily_briefing_minute', "INTEGER NOT NULL DEFAULT 0");
}

module.exports = { getDb, initDb };
