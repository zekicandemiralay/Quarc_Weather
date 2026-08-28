// Remembers which city a user last had open, so the app can land there when
// live location isn't available. Scoped per user id — on a shared device,
// one account's last-viewed city must never leak into another account's
// landing screen.

const key = (userId) => `quarc_weather_last_city_${userId}`;

export function setLastOpenedCity(userId, cityId) {
  if (!userId || !cityId) return;
  try {
    localStorage.setItem(key(userId), cityId);
  } catch {
    /* private mode / quota — non-fatal, it's only a landing-screen hint */
  }
}

export function getLastOpenedCity(userId) {
  if (!userId) return null;
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}
