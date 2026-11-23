import { create } from 'zustand';
import { apiUrl } from './apiUrl';
import { openDb, getMeta } from './localDb.js';
import { createCityStore } from './cities.js';
import { createSyncedPrefs } from './syncedPrefs.js';
import { createSync, createHttpRequest } from './sync.js';
import { createHere } from './here.js';
import { createForecastService } from './forecast/service.js';
import { fetchBundle, reverseGeocode } from './forecast/provider.js';
import { getCurrentPositionSafe } from './geolocation';

// The app's one local-first data layer: a database on this device, the operations the screens use, and the
// engine that mirrors it with the server in the background. The screens import from HERE and never talk to the
// server (or the weather provider) themselves.
//
//   cityStore     the account's manually added cities (synced)
//   prefsData     units / wind / precipitation / language (synced, merged per setting)
//   here          My Location — this device only, never synced
//   forecasts     forecast cache + direct weather provider
//   sync          the engine; start/stop follow the login (see store/authStore.js)

export const db = openDb();

/** What the sync badge shows. `status`: idle | syncing | unreachable | error | auth. */
export const useSyncStore = create(() => ({ status: 'idle', lastSync: null, error: null, pending: 0 }));

let engine;
let authLostHandler = () => {};

// Every local edit: show "N changes to sync" immediately (not only once the next sync attempt has run), then ask
// the engine to sync soon.
const requestSync = () => {
  db.outbox.count().then((pending) => useSyncStore.setState({ pending })).catch(() => {});
  engine?.requestSync();
};

/** The auth store registers what to do when the server says the session is gone (avoids an import cycle). */
export function setAuthLostHandler(fn) {
  authLostHandler = fn;
}

export const cityStore = createCityStore(db, { onWrite: requestSync });
export const prefsData = createSyncedPrefs(db, { onWrite: requestSync });
export const here = createHere(db, { getPosition: getCurrentPositionSafe, reverse: reverseGeocode });
export const forecasts = createForecastService(db, { fetchBundle, getPrefs: () => prefsData.get() });

export const sync = (engine = createSync(db, {
  request: createHttpRequest(apiUrl),
  prefs: prefsData,
  setStatus: (s) => useSyncStore.setState(s),
  onAuthLost: () => authLostHandler(),
}));

// Show the last sync time / queue length straight away, before the first sync of this session finishes.
getMeta(db, 'last_sync').then(async (lastSync) => {
  useSyncStore.setState({ lastSync, pending: await db.outbox.count() });
}).catch(() => {});

let stopLoop = null;

/** Called once the signed-in user is known (online or from the cached login). */
export async function startSyncFor(userId) {
  await sync.adoptUser(userId);
  if (!stopLoop) stopLoop = sync.start();
}

export function stopSync() {
  stopLoop?.();
  stopLoop = null;
}
