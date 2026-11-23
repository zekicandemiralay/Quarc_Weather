// The one-time conversion of the OLD server database (random uuid city ids, a "My Location" pin
// per user, settings in `prefs`) to the synced schema. This is the step that touches real data, so it
// is tested against a faithfully rebuilt legacy database rather than assumed.
//
//   node --test tests/migration.test.js        (needs backend/node_modules — better-sqlite3)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../backend/node_modules/better-sqlite3');
const { migrate } = require('../backend/src/db');
const { cityKey } = require('../backend/src/services/cityKey');

// The legacy schema, exactly as the pre-sync server created it.
const LEGACY_SQL = `
  CREATE TABLE cities (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, country TEXT, country_code TEXT, admin1 TEXT,
    latitude REAL NOT NULL, longitude REAL NOT NULL, timezone TEXT,
    is_current_location INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_cities_user ON cities(user_id, sort_order);
  CREATE UNIQUE INDEX idx_cities_unique ON cities(user_id, ROUND(latitude, 2), ROUND(longitude, 2));
  CREATE TABLE prefs (
    user_id TEXT PRIMARY KEY, units TEXT NOT NULL DEFAULT 'metric', wind_unit TEXT NOT NULL DEFAULT 'kmh',
    precip_unit TEXT NOT NULL DEFAULT 'mm', theme TEXT NOT NULL DEFAULT 'auto', language TEXT NOT NULL DEFAULT 'en',
    updated_at TEXT DEFAULT (datetime('now')),
    daily_briefing_enabled INTEGER NOT NULL DEFAULT 0, daily_briefing_hour INTEGER NOT NULL DEFAULT 8,
    daily_briefing_minute INTEGER NOT NULL DEFAULT 0
  );
`;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-weather-migration-'));
}

function buildLegacy(file) {
  const db = new Database(file);
  db.exec(LEGACY_SQL);
  const city = db.prepare(
    `INSERT INTO cities (id, user_id, name, country, country_code, admin1, latitude, longitude, timezone,
       is_current_location, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  //     id (random uuid in the old server)                 user   name         country     cc    admin1       lat       lon       tz                  pin  order created
  city.run('0b6f6d7e-1111-4a1a-9a9a-000000000001', 'alice', 'Istanbul', 'Türkiye', 'TR', 'Istanbul', 41.0138, 28.9497, 'Europe/Istanbul', 0, 0, '2026-08-30 10:00:00');
  city.run('0b6f6d7e-1111-4a1a-9a9a-000000000002', 'alice', 'Berlin', 'Germany', 'DE', 'Berlin', 52.52, 13.405, 'Europe/Berlin', 0, 1, '2026-08-30 10:05:00');
  city.run('0b6f6d7e-1111-4a1a-9a9a-000000000003', 'alice', 'Cankurtaran', 'Türkiye', 'TR', 'Istanbul', 41.0082, 28.9784, 'Europe/Istanbul', 1, 0, '2026-08-31 09:00:00'); // the server-side "My Location" pin
  city.run('0b6f6d7e-1111-4a1a-9a9a-000000000004', 'bob', 'Istanbul', 'Türkiye', 'TR', 'Istanbul', 41.0138, 28.9497, 'Europe/Istanbul', 0, 0, '2026-09-01 08:00:00'); // same place, different account
  city.run('0b6f6d7e-1111-4a1a-9a9a-000000000005', 'bob', 'Sydney', 'Australia', 'AU', 'NSW', -33.8688, 151.2093, 'Australia/Sydney', 0, 1, '2026-09-01 08:30:00');
  db.prepare(
    `INSERT INTO prefs (user_id, units, wind_unit, precip_unit, theme, language, updated_at, daily_briefing_enabled)
     VALUES ('bob', 'imperial', 'mph', 'inch', 'dark', 'tr', '2026-09-02 12:00:00', 1)`
  ).run();
  return db;
}

test('legacy -> synced: cities keep their data, get coordinate-derived ids, and the pin is dropped', () => {
  const dir = tempDir();
  const file = path.join(dir, 'weather.db');
  const db = buildLegacy(file);

  migrate(db, file);

  const alice = db.prepare('SELECT * FROM cities WHERE user_id = ? ORDER BY sort_order').all('alice');
  assert.deepEqual(alice.map((c) => c.name), ['Istanbul', 'Berlin'], "alice's manual cities, in order; the pin is gone");
  assert.equal(alice[0].id, cityKey(41.0138, 28.9497));
  assert.equal(alice[0].id, 'c_4101_2895');
  assert.equal(alice[1].id, 'c_5252_1341');
  assert.equal(alice[0].timezone, 'Europe/Istanbul');
  assert.equal(alice[0].country, 'Türkiye');
  assert.equal(alice[0].is_deleted, 0);
  assert.equal(alice[0].created_at, '2026-08-30T10:00:00Z', 'legacy "YYYY-MM-DD HH:MM:SS" (UTC) becomes ISO');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cities WHERE name = 'Cankurtaran'").get().n, 0, 'the old server-side My Location pin must not survive');

  // The same place for two accounts is two rows with the SAME id (the key is per account).
  const bob = db.prepare('SELECT id, name FROM cities WHERE user_id = ? ORDER BY sort_order').all('bob');
  assert.deepEqual(bob.map((c) => c.name), ['Istanbul', 'Sydney']);
  assert.equal(bob[0].id, alice[0].id);
  assert.equal(bob[1].id, 'c_-3387_15121', 'negative coordinates produce a valid id');
  assert.match(bob[1].id, /^[A-Za-z0-9_-]{8,64}$/);

  db.close();
});

test('legacy -> synced: every migrated row is immediately visible to a first sync', () => {
  const dir = tempDir();
  const file = path.join(dir, 'weather.db');
  const db = buildLegacy(file);
  migrate(db, file);

  const rows = db.prepare('SELECT updated_at, client_updated_at FROM cities').all();
  assert.equal(rows.length, 4);
  const stamps = rows.map((r) => r.updated_at);
  assert.equal(new Set(stamps).size, stamps.length, 'sync cursors must be unique per row');
  for (const r of rows) {
    assert.ok(r.updated_at > '', 'a device pulling since "" must receive it');
    assert.ok(!Number.isNaN(Date.parse(r.updated_at)) && !Number.isNaN(Date.parse(r.client_updated_at)));
  }
  db.close();
});

test('legacy -> synced: account settings carry over; per-device ones (theme, briefing) are not copied', () => {
  const dir = tempDir();
  const file = path.join(dir, 'weather.db');
  const db = buildLegacy(file);
  migrate(db, file);

  const bob = db.prepare('SELECT * FROM prefs_sync WHERE user_id = ?').get('bob');
  assert.equal(bob.units, 'imperial');
  assert.equal(bob.wind_unit, 'mph');
  assert.equal(bob.precip_unit, 'inch');
  assert.equal(bob.language, 'tr');
  assert.equal(bob.t_units, '2026-09-02T12:00:00Z', 'each field keeps the legacy edit time so a newer device edit wins');
  assert.equal(bob.t_language, '2026-09-02T12:00:00Z');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM prefs_sync WHERE user_id = ?').get('alice').n, 0, 'no row is invented for an account without settings');
  assert.ok(!('theme' in bob) && !('daily_briefing_enabled' in bob), 'theme / briefing stay on each device');

  // The old table is left in place as a record.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM prefs').get().n, 1);
  db.close();
});

test('legacy -> synced: a full copy of the old database is written first, and is the OLD shape', () => {
  const dir = tempDir();
  const file = path.join(dir, 'weather.db');
  const db = buildLegacy(file);
  migrate(db, file);

  const backups = fs.readdirSync(dir).filter((f) => f.startsWith('weather.db.before-sync-'));
  assert.equal(backups.length, 1);
  const old = new Database(path.join(dir, backups[0]), { readonly: true });
  assert.equal(old.prepare('SELECT COUNT(*) n FROM cities').get().n, 5, 'all 5 original rows, pin included');
  assert.ok(old.prepare('PRAGMA table_info(cities)').all().some((c) => c.name === 'is_current_location'));
  old.close();
  db.close();
});

test('migrating twice changes nothing and writes no second backup', () => {
  const dir = tempDir();
  const file = path.join(dir, 'weather.db');
  const db = buildLegacy(file);
  migrate(db, file);
  const snapshot = JSON.stringify(db.prepare('SELECT * FROM cities ORDER BY user_id, id').all());

  migrate(db, file);
  migrate(db, file);

  assert.equal(JSON.stringify(db.prepare('SELECT * FROM cities ORDER BY user_id, id').all()), snapshot);
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.before-sync-')).length, 1);
  db.close();
});

test('a brand-new database just gets the schema (no legacy tables, no backup file)', () => {
  const dir = tempDir();
  const file = path.join(dir, 'weather.db');
  const db = new Database(file);
  migrate(db, file);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['cities', 'prefs_sync', 'server_meta']);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.before-sync-')), []);
  db.close();
});

test('the same city may exist for two accounts, but only once per account', () => {
  const db = new Database(':memory:');
  migrate(db, ':memory:');
  const ins = db.prepare(
    `INSERT INTO cities (user_id, id, name, latitude, longitude, client_updated_at, updated_at, created_at)
     VALUES (?, 'c_4101_2895', 'Istanbul', 41.01, 28.95, 't', 't', 't')`
  );
  ins.run('alice');
  ins.run('bob');
  assert.throws(() => ins.run('alice'), /UNIQUE|PRIMARY KEY/);
  db.close();
});
