import { create } from 'zustand';
import { apiUrl } from '../lib/apiUrl';
import { syncFromStore, watchStoreSession } from '../lib/storeSso';
import { startSyncFor, stopSync, setAuthLostHandler } from '../lib/localData';

const useAuthStore = create((set, get) => ({
  user: JSON.parse(localStorage.getItem('quarc_user') || 'null'),
  loading: true,

  async login(username, password) {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }
    const user = await res.json();
    localStorage.setItem('quarc_user', JSON.stringify(user));
    // Adopt the account BEFORE any screen reads local data: if a different person used this device last, their
    // cities are wiped here rather than shown for a moment.
    await startSyncFor(user.id); // also starts feeding the home-screen widget (Android)
    set({ user, loading: false });
    return user;
  },

  async logout() {
    await fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {});
    stopSync(); // also clears the widget's places
    localStorage.removeItem('quarc_user');
    set({ user: null, loading: false });
  },

  async checkSession() {
    // On Android, Quarc Store (if installed) is the primary login source:
    // this applies its sign-in/sign-out to this app's cookie, if it changed.
    await syncFromStore();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include', signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const user = await res.json();
        localStorage.setItem('quarc_user', JSON.stringify(user));
        await startSyncFor(user.id); // also starts feeding the home-screen widget (Android)
        set({ user, loading: false });
      } else {
        stopSync();
        localStorage.removeItem('quarc_user');
        set({ user: null, loading: false });
      }
    } catch {
      // The server can't be reached (Tailscale off, server down, no network): keep the last known login and carry
      // on from the local database — the app is fully usable, changes just wait to sync.
      const cachedUser = get().user;
      if (cachedUser) startSyncFor(cachedUser.id).catch(() => {});
      set({ user: cachedUser, loading: false });
    }
  },
}));

// Signing in/out in Quarc Store applies as soon as the user switches back here.
watchStoreSession(() => useAuthStore.getState().checkSession());

// The sync engine got a 401: the session is gone. Re-check, which routes to the login screen if need be.
setAuthLostHandler(() => useAuthStore.getState().checkSession());

export default useAuthStore;
