import { getMeta, setMeta } from './localDb.js';

// "My Location" belongs to THIS device. It is never a row in the synced city list: a phone in Istanbul and a
// laptop in Berlin each have their own, and neither is sent to the server. All that is kept is the last GPS fix
// and the place name it resolved to, so the card still shows something sensible when there is no signal.
//
// A place-name lookup (OpenStreetMap Nominatim) happens only when it is needed: the first time, after the
// device has moved a few kilometres, or when the app language changed. If the device has moved far and the
// lookup fails (offline), the old name would now be WRONG, so it is dropped and the card shows coordinates
// until a name can be found.

const META_KEY = 'here';
const MOVED_KM = 3;

export const HERE_ID = 'here';

export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * @param getPosition ({timeout}) => Promise<{latitude, longitude}|null>   (never rejects; null = no fix)
 * @param reverse     (lat, lon, {language}) => Promise<{name, admin1, country}|null>   (never rejects)
 */
export function createHere(db, { getPosition, reverse, now = () => new Date() }) {
  const get = () => getMeta(db, META_KEY, null);

  /**
   * Takes a fresh GPS fix if it can. Always resolves with the best record available:
   *   { record, fresh }  — `fresh` is true only when THIS call obtained a new fix, which is what decides whether
   *   the app should open on My Location (a denied permission must not keep landing there on an old fix).
   */
  async function refresh({ language = 'en', timeout } = {}) {
    const prev = await get();
    const fix = await getPosition({ timeout });
    if (!fix) return { record: prev, fresh: false };

    let rec = { ...(prev || {}), latitude: fix.latitude, longitude: fix.longitude, at: now().toISOString() };

    const moved = prev?.named_lat != null && distanceKm(fix, { latitude: prev.named_lat, longitude: prev.named_lon }) > MOVED_KM;
    const needName = !prev?.name || prev.named_lat == null || moved || prev.language !== language;

    if (needName) {
      const named = await reverse(fix.latitude, fix.longitude, { language });
      if (named) {
        rec = { ...rec, name: named.name, admin1: named.admin1, country: named.country, named_lat: fix.latitude, named_lon: fix.longitude, language };
      } else if (moved || !prev?.name) {
        // Far from where the old name was found and no new name available: show coordinates, not a wrong place.
        rec = { ...rec, name: null, admin1: null, country: null, named_lat: null, named_lon: null, language };
      }
    }
    await setMeta(db, META_KEY, rec);
    return { record: rec, fresh: true };
  }

  /** The record as a city-shaped object the screens already understand, or null if there has never been a fix. */
  function asCity(rec) {
    if (!rec || rec.latitude == null) return null;
    return {
      id: HERE_ID,
      is_current_location: true,
      name: rec.name || `${rec.latitude.toFixed(3)}, ${rec.longitude.toFixed(3)}`,
      admin1: rec.admin1 || null,
      country: rec.country || null,
      latitude: rec.latitude,
      longitude: rec.longitude,
      timezone: null, // the forecast reports the zone itself ("timezone=auto")
    };
  }

  return { get, refresh, asCity };
}
