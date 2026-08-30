// Thin wrapper around the native NotificationBridge Capacitor plugin
// (Android only — see mobile/android/.../NotificationBridgePlugin.java). A
// no-op everywhere else, same pattern as widgetBridge.js.

function bridge() {
  return window?.Capacitor?.isNativePlatform?.() ? window?.Capacitor?.Plugins?.NotificationBridge : null;
}

/**
 * Pushes the daily-briefing prefs (server-synced, so they follow the
 * account to every device) down into native scheduling. Safe to call on
 * every prefs load/update — the native side just re-applies its
 * SharedPreferences + WorkManager schedule idempotently.
 *
 * Requests Android's notification permission the first time this is called
 * with enabled=true and it isn't already granted — i.e. right when the user
 * actually turns the toggle on in Settings, not proactively at app launch.
 */
export function syncDailyBriefingSchedule(prefs) {
  const plugin = bridge();
  if (!plugin) return;
  plugin
    .setDailyBriefing({
      enabled: !!prefs.daily_briefing_enabled,
      hour: Number(prefs.daily_briefing_hour ?? 8),
      minute: Number(prefs.daily_briefing_minute ?? 0),
    })
    .catch(() => {});
}
