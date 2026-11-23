import { create } from 'zustand';
import { liveQuery } from 'dexie';
import { prefsData } from '../lib/localData';
import { syncDailyBriefingSchedule } from '../lib/notificationBridge';
import i18n from '../i18n';

// Two kinds of setting:
//   SYNCED   units, wind speed, precipitation, language — follow the account to every device, are stored in the
//            local database and merged field by field with the server (lib/syncedPrefs.js).
//   DEVICE   theme and the daily-briefing schedule — each device has its own (a phone wants a morning
//            notification; a laptop does not), kept in localStorage and never sent anywhere.
//
// A copy of everything is also kept in localStorage so the first paint (language, theme) never waits on the database.

const SYNCED_KEYS = ['units', 'wind_unit', 'precip_unit', 'language'];
const DEVICE_KEYS = ['theme', 'daily_briefing_enabled', 'daily_briefing_hour', 'daily_briefing_minute'];

const DEFAULTS = {
  units: 'metric',
  wind_unit: 'kmh',
  precip_unit: 'mm',
  language: 'en',
  theme: 'auto',
  daily_briefing_enabled: 0,
  daily_briefing_hour: 8,
  daily_briefing_minute: 0,
};

const CACHE_KEY = 'quarc_weather_prefs';

const cached = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
})();

function persistLocal(prefs) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* non-fatal */
  }
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

let watching = null;

const usePrefsStore = create((set, get) => ({
  prefs: cached,
  loaded: false,

  /** Reads the synced settings from the local database and keeps following it, so a setting changed on another
   *  device (merged in by the sync engine) shows up here without a reload. */
  async load() {
    const apply = (synced) => {
      const current = get().prefs;
      const changed = SYNCED_KEYS.some((k) => current[k] !== synced[k]);
      if (!changed) return;
      const next = { ...current, ...synced };
      persistLocal(next);
      set({ prefs: next });
      if (synced.language && synced.language !== i18n.language) i18n.changeLanguage(synced.language);
    };

    apply(await prefsData.get());
    if (!watching) {
      watching = liveQuery(() => prefsData.get()).subscribe({ next: apply, error: () => {} });
    }
    syncDailyBriefingSchedule(get().prefs);
    set({ loaded: true });
  },

  async update(patch) {
    // Applied immediately — unit toggles should feel instant — and written to the local database; the sync
    // engine carries the synced ones to the server whenever it can.
    const next = { ...get().prefs, ...patch };
    persistLocal(next);
    set({ prefs: next });

    if (patch.language) i18n.changeLanguage(patch.language);
    if ('daily_briefing_enabled' in patch || 'daily_briefing_hour' in patch || 'daily_briefing_minute' in patch) {
      syncDailyBriefingSchedule(next);
    }

    const synced = pick(patch, SYNCED_KEYS);
    if (Object.keys(synced).length) await prefsData.set(synced);
  },
}));

export { SYNCED_KEYS, DEVICE_KEYS };
export default usePrefsStore;
