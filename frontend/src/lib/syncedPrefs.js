// The settings that follow the ACCOUNT between devices: units, wind speed, precipitation and language.
// (Theme and the daily-briefing schedule are per device and are not stored or synced here.)
//
// Every field carries its own edit time `t`. Merging is field by field — the newer edit of each field wins —
// so changing units on one device and the language on another keeps both changes, which a single
// "whole settings object, last writer wins" would not.

export const DEFAULTS = { units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', language: 'en' };

export const ALLOWED = {
  units: ['metric', 'imperial'],
  wind_unit: ['kmh', 'ms', 'mph', 'kn'],
  precip_unit: ['mm', 'inch'],
  language: ['en', 'tr'],
};

const ROW_KEY = 'synced';
const OUTBOX_KEY = 'prefs:prefs';

/** Newer-edit-wins merge of two `fields` objects. Returns the merged fields and whether `local` changed. */
export function mergeFields(local = {}, remote = {}) {
  const merged = { ...local };
  let changed = false;
  for (const key of Object.keys(ALLOWED)) {
    const r = remote[key];
    if (!r || !ALLOWED[key].includes(r.value) || !r.t) continue;
    if (!merged[key] || r.t > merged[key].t) {
      merged[key] = { value: r.value, t: r.t };
      changed = true;
    } else if (r.t < merged[key].t && r.value === merged[key].value) {
      // Same value, but the server holds an EARLIER time: it capped ours (a device clock running more than
      // 5 minutes fast). Agree with the server — otherwise this device would think its copy is newer and
      // queue it again on every sync, forever.
      merged[key] = { value: r.value, t: r.t };
      changed = true;
    }
  }
  return { merged, changed };
}

export function createSyncedPrefs(db, { now = () => new Date(), onWrite = () => {} } = {}) {
  async function readFields() {
    return (await db.prefs.get(ROW_KEY))?.fields || {};
  }

  /** The current values, with defaults for anything never edited. */
  async function get() {
    const fields = await readFields();
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) if (fields[key]) out[key] = fields[key].value;
    return out;
  }

  function outboxEntry(fields, t) {
    return { key: OUTBOX_KEY, table: 'prefs', id: 'prefs', op: 'upsert', data: { fields }, client_updated_at: t };
  }

  /** Changes one or more settings, e.g. `set({ units: 'imperial' })`. Unknown keys/values are ignored. */
  async function set(patch) {
    const t = now().toISOString();
    let changed = false;
    await db.transaction('rw', db.prefs, db.outbox, async () => {
      const fields = { ...(await readFields()) };
      for (const [key, value] of Object.entries(patch)) {
        if (!ALLOWED[key]?.includes(value)) continue;
        if (fields[key]?.value === value) continue;
        fields[key] = { value, t };
        changed = true;
      }
      if (!changed) return;
      await db.prefs.put({ key: ROW_KEY, fields });
      // The whole fields object goes out each time: the server only applies fields that are NEWER than its
      // own, so resending an older field is harmless — and an earlier unsent edit is never lost when a
      // newer one replaces its queue entry.
      await db.outbox.put(outboxEntry(fields, t));
    });
    if (changed) onWrite();
    return get();
  }

  /**
   * Folds the server's copy into the local one (field by field, newer wins). If this device holds a field
   * NEWER than the server's, it is queued to be pushed again — which also repairs a server restored from
   * an old backup. Call inside a transaction that includes db.prefs and db.outbox.
   */
  async function mergeFromServer(remoteFields) {
    const local = await readFields();
    const { merged, changed } = mergeFields(local, remoteFields);
    if (changed) await db.prefs.put({ key: ROW_KEY, fields: merged });

    const newerLocal = Object.keys(ALLOWED).some((k) => merged[k] && (!remoteFields?.[k] || merged[k].t > (remoteFields[k].t || '')));
    if (newerLocal && !(await db.outbox.get(OUTBOX_KEY))) {
      await db.outbox.put(outboxEntry(merged, now().toISOString()));
    }
    return changed;
  }

  return { get, set, mergeFromServer, OUTBOX_KEY };
}
