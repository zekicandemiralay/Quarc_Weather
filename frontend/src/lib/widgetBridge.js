// Thin wrapper around the native WidgetBridge Capacitor plugin (Android
// only — see mobile/android/.../WidgetBridgePlugin.java). Every call is a
// no-op on web/desktop/iOS, so callers never need their own platform check.

import { API_BASE } from './apiUrl';

function bridge() {
  return window?.Capacitor?.isNativePlatform?.() ? window?.Capacitor?.Plugins?.WidgetBridge : null;
}

/**
 * Harvests the session cookie into native storage so the home-screen widget
 * can refresh itself in the background. Safe to call liberally — it's a
 * fire-and-forget no-op if there's nothing new to harvest yet.
 */
export function syncWidgetSession() {
  const plugin = bridge();
  if (!plugin || !API_BASE) return;
  plugin.syncSession({ serverOrigin: API_BASE }).catch(() => {});
}

/** Clears the native session on logout, so a stale token can't keep the
 *  widget refreshing after the user has explicitly signed out. */
export function clearWidgetSession() {
  bridge()?.clearSession().catch(() => {});
}

/**
 * Shows the OS's native "Add to Home Screen?" confirmation for the widget —
 * the plugin itself only ever does this once (tracked in native
 * SharedPreferences), so it's safe to call every time real weather data has
 * been shown.
 */
export function offerWidgetPin() {
  bridge()?.offerPin().catch(() => {});
}
