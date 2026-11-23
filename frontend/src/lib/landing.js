import { db, here } from './localData';
import { HERE_ID } from './here';
import { getLastOpenedCity } from './lastOpened';
import i18n from '../i18n';

/**
 * Decides where the app should land on open, in priority order:
 *   1. My Location, if this device just got a live GPS fix
 *   2. The last city the user had open (if it still exists)
 *   3. Nothing — the caller falls back to the plain city list
 *
 * Everything is answered from the local database: no server is asked, so this works the same with Tailscale off.
 * Every failure along the way — permission denied, no GPS fix, a deleted last-opened city — is swallowed and just
 * moves to the next priority. A denied location prompt is a normal, silent outcome, not an error.
 *
 * @returns {Promise<string|null>} a city id to navigate to ('here' for My Location), or null to stay on the list.
 */
export async function resolveLandingCityId(userId) {
  let record = null;
  try {
    const result = await here.refresh({ language: i18n.language, timeout: 8000 });
    record = result.record;
    // Only a FRESH fix lands on My Location: a permission that was later denied must not keep opening an old fix.
    if (result.fresh) return HERE_ID;
  } catch {
    /* fall through to the last-opened city */
  }

  const lastId = getLastOpenedCity(userId);
  if (lastId === HERE_ID && record) return HERE_ID;
  if (lastId && lastId !== HERE_ID) {
    try {
      const row = await db.cities.get(lastId);
      if (row && !row.is_deleted) return lastId;
    } catch {
      /* local database unavailable — show the list */
    }
  }

  return null;
}
