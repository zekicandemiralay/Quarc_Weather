import { cityKey } from './cityKey.js';

// Everything the UI does to the city list. Each operation writes to the LOCAL database and queues the change
// for the server in one transaction, then calls `onWrite` (which asks the sync engine to run soon). Nothing
// here ever waits for the network — that is what makes the list work with the server out of reach.

const PUSHED_FIELDS = ['name', 'country', 'country_code', 'admin1', 'latitude', 'longitude', 'timezone', 'sort_order', 'created_at'];

/** The deterministic display order: by position, then by when it was added, then by id. Two devices that
 *  independently added different cities at the same position settle into the same order everywhere. */
export const byOrder = (a, b) =>
  a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id);

function mutation(op, row, t) {
  const m = { key: `cities:${row.id}`, table: 'cities', id: row.id, op, client_updated_at: t };
  if (op === 'upsert') m.data = Object.fromEntries(PUSHED_FIELDS.map((f) => [f, row[f]]));
  return m;
}

export function createCityStore(db, { now = () => new Date(), onWrite = () => {} } = {}) {
  const stamp = () => now().toISOString();

  /** The live (not deleted) cities, in display order. */
  async function listCities() {
    return (await db.cities.where('is_deleted').equals(0).toArray()).sort(byOrder);
  }

  /** The city already saved at these coordinates (same ~1 km cell), if any. */
  async function findCity(latitude, longitude) {
    const row = await db.cities.get(cityKey(latitude, longitude));
    return row && !row.is_deleted ? row : null;
  }

  /**
   * Saves a city picked from search. Adding a place that is already in the list is a no-op (returns the existing
   * row); adding one that was deleted brings it back — the same id, with a newer edit time.
   */
  async function addCity(place) {
    const id = cityKey(place.latitude, place.longitude);
    const t = stamp();
    let saved;
    let added = false;

    await db.transaction('rw', db.cities, db.outbox, async () => {
      const existing = await db.cities.get(id);
      if (existing && !existing.is_deleted) {
        saved = existing;
        return;
      }
      const live = await db.cities.where('is_deleted').equals(0).toArray();
      saved = {
        id,
        name: place.name,
        country: place.country ?? null,
        country_code: place.country_code ?? null,
        admin1: place.admin1 ?? null,
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone ?? null,
        sort_order: live.length ? Math.max(...live.map((c) => c.sort_order)) + 1 : 0,
        is_deleted: 0,
        client_updated_at: t,
        updated_at: existing?.updated_at ?? '',
        created_at: existing?.created_at ?? t,
      };
      await db.cities.put(saved);
      await db.outbox.put(mutation('upsert', saved, t));
      added = true;
    });

    if (added) onWrite();
    return { city: saved, added };
  }

  /** Removes a city. It stays as a tombstone so the deletion reaches the other devices. */
  async function removeCity(id) {
    const t = stamp();
    let changed = false;
    await db.transaction('rw', db.cities, db.outbox, async () => {
      const row = await db.cities.get(id);
      if (!row || row.is_deleted) return;
      const next = { ...row, is_deleted: 1, client_updated_at: t };
      await db.cities.put(next);
      await db.outbox.put(mutation('delete', next, t));
      changed = true;
    });
    if (changed) onWrite();
  }

  /**
   * Moves a city up (-1) or down (+1) one place. Only the moved city changes: it takes a position halfway
   * between its new neighbours, so another device moving a DIFFERENT city at the same time merges cleanly.
   * If positions have run out of room (or tied, after two devices added cities at once) the whole list is
   * renumbered instead.
   */
  async function moveCity(id, delta) {
    const t = stamp();
    let changed = false;

    await db.transaction('rw', db.cities, db.outbox, async () => {
      const list = (await db.cities.where('is_deleted').equals(0).toArray()).sort(byOrder);
      const from = list.findIndex((c) => c.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;

      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      const prev = list[to - 1];
      const next = list[to + 1];

      let order;
      if (prev && next) order = (prev.sort_order + next.sort_order) / 2;
      else if (prev) order = prev.sort_order + 1;
      else if (next) order = next.sort_order - 1;
      else order = 0;

      const crowded = prev && next && !(order > prev.sort_order && order < next.sort_order);
      if (crowded) {
        // No room between the neighbours: renumber everything 0..n-1 (each changed row is queued).
        for (let i = 0; i < list.length; i++) {
          if (list[i].sort_order === i) continue;
          const row = { ...list[i], sort_order: i, client_updated_at: t };
          await db.cities.put(row);
          await db.outbox.put(mutation('upsert', row, t));
        }
      } else {
        const row = { ...moved, sort_order: order, client_updated_at: t };
        await db.cities.put(row);
        await db.outbox.put(mutation('upsert', row, t));
      }
      changed = true;
    });

    if (changed) onWrite();
  }

  return { listCities, findCity, addCity, removeCity, moveCity };
}
