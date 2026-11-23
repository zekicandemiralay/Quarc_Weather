// Thin wrapper around the native WidgetBridge Capacitor plugin (Android
// only — see mobile/android/.../WidgetBridgePlugin.java). Every call is a
// no-op on web/desktop/iOS, so callers never need their own platform check.

function bridge() {
  return window?.Capacitor?.isNativePlatform?.() ? window?.Capacitor?.Plugins?.WidgetBridge : null;
}

/** True where there is a native widget to feed (the Android app). */
export const hasWidgetBridge = () => !!bridge();

/**
 * Hands the native side the places to show ({id, name, latitude, longitude, isPin}[]) and the unit setting
 * ('metric' | 'imperial'). The widget and the morning briefing fetch the weather for them directly from the
 * weather provider, in the background, without the app being open. The native side only refreshes the widget
 * when the list actually changed, so calling this on every app start is fine.
 */
export function syncWidgetCities({ cities, units }) {
  bridge()?.syncCities({ cities, units }).catch(() => {});
}

/** On logout: the widget stops showing (and refreshing) the previous person's places. */
export function clearWidgetCities() {
  bridge()?.clearCities().catch(() => {});
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

/** How many copies of the widget are on the home screen (0 when unknown or not Android). */
export async function getWidgetCount() {
  const plugin = bridge();
  if (!plugin?.widgetCount) return 0;
  try {
    return Number((await plugin.widgetCount())?.count) || 0;
  } catch {
    return 0;
  }
}

/** Opens the native widget settings screen: layout, background (incl. transparent), text, city. */
export function openWidgetSettings() {
  return bridge()?.openSettings?.().catch(() => {});
}

/**
 * Asks Android to add the widget now. Resolves true if the launcher accepted the request,
 * false if it can't add widgets itself (the user then adds it from the widget picker).
 */
export async function requestWidgetPin() {
  const plugin = bridge();
  if (!plugin?.requestPin) return false;
  try {
    return !!(await plugin.requestPin())?.supported;
  } catch {
    return false;
  }
}
