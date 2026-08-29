import { listCities, addCity } from './api';
import { getCurrentPositionSafe, currentLocationPayload } from './geolocation';
import { getLastOpenedCity } from './lastOpened';
import i18n from '../i18n';

/**
 * Decides where the app should land on open, in priority order:
 *   1. Live current location (if permitted and reachable)
 *   2. The last city the user had open (if it still exists)
 *   3. Nothing — the caller falls back to the plain city list
 *
 * Every failure mode along the way — permission denied, no GPS fix, offline,
 * a deleted last-opened city — is swallowed here and just moves to the next
 * priority. None of this should ever surface as an error to the user; a
 * denied location prompt is a normal, silent outcome, not a failure.
 *
 * @returns {Promise<string|null>} a city id to navigate to, or null to stay
 *   on the list.
 */
export async function resolveLandingCityId(userId) {
  const coords = await getCurrentPositionSafe();
  if (coords) {
    try {
      const city = await addCity(currentLocationPayload(coords, i18n.language));
      return city.id;
    } catch {
      /* offline, server error — fall through to last-opened */
    }
  }

  const lastId = getLastOpenedCity(userId);
  if (lastId) {
    try {
      const cities = await listCities();
      if (cities.some((c) => c.id === lastId)) return lastId;
    } catch {
      /* offline — can't confirm it still exists, fall through to the list */
    }
  }

  return null;
}
