// Thin geolocation helpers shared between the app's landing screen (auto
// current-location on open) and the manual "Use my location" button on the
// add-city screen — both need the exact same coordinate-fetch and payload
// shape, and should stay in sync if either ever changes.

/**
 * Wraps geolocation in a Promise that never rejects — it resolves `null` for
 * every failure mode (no API, permission denied, timeout, no fix), so
 * callers can treat "no location" as a plain falsy value instead of a
 * try/catch.
 *
 * On Android, this goes through the native @capacitor/geolocation plugin
 * rather than the WebView's own navigator.geolocation. A plain WebView call
 * is unreliable there even with the manifest permissions declared — Android
 * additionally requires the app to drive the runtime permission dialog
 * itself (checkPermissions/requestPermissions), which raw navigator.* has no
 * way to trigger. Web, PWA, and desktop (Tauri) all still use the standard
 * browser API, which works fine in those contexts.
 */
export async function getCurrentPositionSafe({ timeout = 8000 } = {}) {
  const isNative = window?.Capacitor?.isNativePlatform?.();
  const Geo = window?.Capacitor?.Plugins?.Geolocation;

  if (isNative && Geo) {
    try {
      const perm = await Geo.requestPermissions();
      const granted = perm?.location === 'granted' || perm?.coarseLocation === 'granted';
      if (!granted) return null;
      const pos = await Geo.getCurrentPosition({ timeout, enableHighAccuracy: false });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      return null;
    }
  }

  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // A hard timeout independent of the browser's own, so a stuck GPS fix
    // can't hang the caller indefinitely.
    const guard = setTimeout(() => done(null), timeout);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(guard);
        done({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        clearTimeout(guard);
        done(null);
      },
      { timeout, enableHighAccuracy: false, maximumAge: 5 * 60 * 1000 }
    );
  });
}
