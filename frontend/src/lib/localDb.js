import Dexie from 'dexie';

// The device's own copy of everything it needs. The UI only ever reads and writes THIS database;
// lib/sync.js mirrors it with the server in the background whenever the server is reachable.
//
//   cities     the account's manually added cities, in the server's row shape, INCLUDING tombstones
//              (is_deleted = 1) so deletions can sync. Ids are derived from the coordinates (lib/cityKey.js).
//   outbox     one pending change per row, keyed 'cities:<id>' or 'prefs:prefs'. A later edit of the same
//              row replaces the earlier entry, so the queue never grows beyond the number of rows.
//   prefs      the synced settings: { key: 'synced', fields: { units: { value, t }, ... } } — every field
//              carries its own edit time, which is what lets two devices change different settings and
//              keep both. (Theme and the daily briefing are per device and live in localStorage.)
//   forecasts  the last forecast bundle per city ('here' for My Location), shown when a refresh fails
//   meta       small key/value store: sync cursor, owning user id, last sync time, the My Location fix...
//
// My Location is deliberately NOT a row in `cities`: it belongs to this device and is never synced.

export function openDb(name = 'quarc-weather') {
  const db = new Dexie(name);
  db.version(1).stores({
    cities: 'id, is_deleted',
    outbox: 'key',
    prefs: 'key',
    forecasts: 'key',
    meta: 'key',
  });
  return db;
}

export async function getMeta(db, key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export function setMeta(db, key, value) {
  return db.meta.put({ key, value });
}

/** Wipes the account-owned data (used when a different person logs in on this device). */
export async function clearAccountData(db) {
  await Promise.all([db.cities.clear(), db.outbox.clear(), db.prefs.clear(), db.forecasts.clear(), db.meta.clear()]);
}
