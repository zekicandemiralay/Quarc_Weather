import { getMeta, setMeta, clearAccountData } from './localDb.js';
import { mergeFields } from './syncedPrefs.js';

// Sync engine — the same design as Quarc Calendar's. The UI never waits on the network: every edit is written
// to the local database and queued in the `outbox` (lib/cities.js, lib/syncedPrefs.js). This module drains the
// outbox to the server and pulls other devices' changes whenever the server can be reached.
//
// "Reachable" is NOT the same as "online": a phone with perfectly good internet but Tailscale switched off
// cannot resolve the server's address at all. That shows as status 'unreachable' (calm, expected) rather than
// 'error' (something is actually wrong). Either way nothing is lost — changes stay queued and the next trigger
// retries. Triggers: app start, after every local write (debounced), the browser's 'online' event, the tab
// regaining focus, and a 30 s heartbeat.
//
// Conflicts: the newest edit (by the editing device's clock) wins, row by row; settings merge field by field.

export class AuthError extends Error {}
export class UnreachableError extends Error {}

const REQUEST_TIMEOUT_MS = 8000;

/**
 * The real transport: fetch against the Quarc server with the login cookie. A request that cannot connect
 * (no route to the tailnet, DNS failure, server down) or takes too long becomes UnreachableError.
 */
export function createHttpRequest(apiUrl) {
  return async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl(path), {
        method,
        credentials: 'include',
        signal: controller.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) throw new AuthError('Session expired');
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return await res.json();
    } catch (e) {
      if (e instanceof AuthError || e instanceof UnreachableError) throw e;
      if (e?.name === 'AbortError' || e instanceof TypeError) throw new UnreachableError(e.message || 'unreachable');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * @param db        the Dexie database (lib/localDb.js)
 * @param request   (path, {method, body}) => Promise<json>; throws AuthError / UnreachableError
 * @param prefs     the synced-prefs store (needed to merge settings the server sends back)
 * @param setStatus ({ status, lastSync?, error?, pending? }) => void — wired to the UI's sync badge
 * @param now       clock, injectable for tests
 */
export function createSync(db, { request, prefs, setStatus = () => {}, onAuthLost = () => {}, onChange = () => {} }) {
  let current = null;
  let rerun = false;
  let debounceTimer = null;

  // ---- Push -----------------------------------------------------------------

  async function pushOutbox() {
    for (;;) {
      const batch = await db.outbox.limit(200).toArray();
      if (!batch.length) return;

      const { results } = await request('/api/sync/push', {
        method: 'POST',
        body: {
          mutations: batch.map((m) => ({
            table: m.table, id: m.id, op: m.op, data: m.data, client_updated_at: m.client_updated_at,
          })),
        },
      });

      const sent = new Map(batch.map((m) => [m.key, m]));
      await db.transaction('rw', db.cities, db.prefs, db.outbox, async () => {
        for (const r of results) {
          const key = `${r.table}:${r.id}`;
          const was = sent.get(key);
          if (!was) continue;
          // If the user edited this row again while the request was in flight, the queue entry is newer
          // than what was sent: keep it for the next round.
          const queued = await db.outbox.get(key);
          const unchanged = queued && queued.client_updated_at === was.client_updated_at;

          if (r.table === 'prefs') {
            if (r.row) await prefs.mergeFromServer(r.row.fields); // the server's merged result is the truth
            if (unchanged) await db.outbox.delete(key);
          } else if (r.status === 'stale' && r.row) {
            // Another device wrote a newer version first: adopt it, drop ours.
            if (unchanged) {
              await db.cities.put(r.row);
              await db.outbox.delete(key);
            }
          } else if (unchanged) {
            // 'ok' — and also 'invalid', which can never succeed on retry.
            await db.outbox.delete(key);
          }
        }
      });
      if (batch.length < 200) return;
    }
  }

  // ---- Pull -----------------------------------------------------------------

  async function pullChanges() {
    for (;;) {
      const since = await getMeta(db, 'cursor', '');
      const data = await request(`/api/sync/pull?since=${encodeURIComponent(since)}`);

      await db.transaction('rw', db.cities, db.prefs, db.outbox, db.meta, async () => {
        for (const row of data.cities) {
          const pending = await db.outbox.get(`cities:${row.id}`);
          // Never clobber a local edit that has not been uploaded yet and is newer.
          if (pending && pending.client_updated_at > row.client_updated_at) continue;
          if (pending) await db.outbox.delete(`cities:${row.id}`); // the server's version supersedes ours
          await db.cities.put(row);
        }
        if (data.prefs) await prefs.mergeFromServer(data.prefs.fields);
        await setMeta(db, 'cursor', data.cursor);
      });
      if (!data.hasMore) return;
    }
  }

  // ---- Public API --------------------------------------------------------------

  async function report(patch) {
    setStatus({ ...patch, pending: await db.outbox.count() });
  }

  /** Runs a sync. Calls made during a run schedule exactly one more pass after it. */
  function syncNow() {
    if (current) {
      rerun = true;
      return current;
    }
    current = (async () => {
      try {
        await report({ status: 'syncing', error: null });
        await pushOutbox();
        await pullChanges();
        const when = new Date().toISOString();
        await setMeta(db, 'last_sync', when);
        await report({ status: 'idle', lastSync: when, error: null });
        onChange();
      } catch (e) {
        if (e instanceof AuthError) {
          await report({ status: 'auth', error: e.message });
          onAuthLost();
        } else if (e instanceof UnreachableError) {
          await report({ status: 'unreachable', error: null });
        } else {
          await report({ status: 'error', error: e.message });
        }
      } finally {
        current = null;
        if (rerun) {
          rerun = false;
          setTimeout(syncNow, 0);
        }
      }
    })();
    return current;
  }

  /** Called after every local write: batch bursts of edits into one request. */
  function requestSync() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncNow, 600);
  }

  /** Browser wiring: the triggers listed at the top of this file. Returns a stop function. */
  function start() {
    const onOnline = () => syncNow();
    const onVisible = () => document.visibilityState === 'visible' && syncNow();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(syncNow, 30000);
    syncNow();
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
      clearTimeout(debounceTimer);
    };
  }

  /** Local data belongs to one account: wipe it when a DIFFERENT person logs in on this device. */
  async function adoptUser(userId) {
    const owner = await getMeta(db, 'user_id');
    if (owner && owner !== userId) await clearAccountData(db);
    if (owner !== userId) await setMeta(db, 'user_id', userId);
  }

  return { syncNow, requestSync, start, adoptUser };
}

export { mergeFields };
