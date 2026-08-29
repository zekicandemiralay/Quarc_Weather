import { create } from 'zustand';
import { checkForUpdate } from '../lib/updateCheck';

// Backs the startup update banner (matches Quarc Music's behavior — checked
// automatically on open, not just from the Settings screen). A Zustand
// store rather than component state because ProtectedRoute mounts fresh on
// every route change (each <Route> wraps its own element separately, unlike
// a single persistent Layout) — this is what makes the check run once per
// app session instead of once per navigation.
const useUpdateStore = create((set, get) => ({
  update: null,
  checked: false,
  dismissed: false,

  ensureChecked() {
    if (get().checked) return;
    set({ checked: true });
    // Delayed so it doesn't compete with the app's own first-load network
    // traffic — the landing screen's geolocation + weather fetch matter more
    // than an update check that can just as well happen a few seconds late.
    setTimeout(async () => {
      try {
        const result = await checkForUpdate();
        set({ update: result });
      } catch {
        /* no banner is not worth surfacing an error for */
      }
    }, 6000);
  },

  dismiss: () => set({ dismissed: true }),
}));

export default useUpdateStore;
