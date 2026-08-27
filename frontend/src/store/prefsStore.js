import { create } from 'zustand';
import { getPrefs, savePrefs } from '../lib/api';
import i18n from '../i18n';

const DEFAULTS = { units: 'metric', wind_unit: 'kmh', precip_unit: 'mm', theme: 'auto', language: 'en' };

// Preferences live on the server so they follow the account to every device,
// but a local copy is kept so first paint doesn't wait on a round trip.
const cached = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('quarc_weather_prefs') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
})();

function persistLocal(prefs) {
  try {
    localStorage.setItem('quarc_weather_prefs', JSON.stringify(prefs));
  } catch {
    /* non-fatal */
  }
}

const usePrefsStore = create((set, get) => ({
  prefs: cached,
  loaded: false,

  async load() {
    try {
      const prefs = await getPrefs();
      persistLocal(prefs);
      if (prefs.language !== i18n.language) i18n.changeLanguage(prefs.language);
      set({ prefs, loaded: true });
    } catch {
      set({ loaded: true }); // offline — keep the cached copy
    }
  },

  async update(patch) {
    // Apply optimistically: unit toggles should feel instant, and the server
    // is the tiebreaker only if it rejects the value.
    const optimistic = { ...get().prefs, ...patch };
    persistLocal(optimistic);
    set({ prefs: optimistic });

    if (patch.language) i18n.changeLanguage(patch.language);

    try {
      const saved = await savePrefs(patch);
      persistLocal(saved);
      set({ prefs: saved });
    } catch {
      /* stays applied locally; retried on next load */
    }
  },
}));

export default usePrefsStore;
