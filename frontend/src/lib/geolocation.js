// Thin geolocation helpers shared between the app's landing screen (auto
// current-location on open) and the manual "Use my location" button on the
// add-city screen — both need the exact same coordinate-fetch and payload
// shape, and should stay in sync if either ever changes.

/**
 * Wraps navigator.geolocation in a Promise that never rejects — it resolves
 * `null` for every failure mode (no API, permission denied, timeout, no
 * fix), so callers can treat "no location" as a plain falsy value instead
 * of a try/catch. A hard timeout is enforced here too, independent of the
 * browser's own, so a stuck GPS fix can't hang the caller indefinitely.
 */
export function getCurrentPositionSafe({ timeout = 8000 } = {}) {
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

/**
 * The payload the backend expects for a live-location save. Coordinates are
 * used as a plain, honest label — Open-Meteo has no reverse-geocoding
 * endpoint, so anything fancier (e.g. searching the geocoder for a nearby
 * name) risks showing an unrelated place instead of where the user actually
 * is. The UI never shows this string anyway; is_current_location renders as
 * "My Location" everywhere it's displayed.
 */
export function currentLocationPayload({ latitude, longitude }) {
  return {
    name: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
    latitude,
    longitude,
    is_current_location: true,
  };
}
