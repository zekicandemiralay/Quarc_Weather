// What the home-screen widget and the morning briefing are told about: the places to show, and the unit setting.
// They run in their own process, outside the app, with no access to its database — so the app hands the list
// over (lib/widgetBridge.js → WidgetBridgePlugin) whenever it changes, and they fetch the weather themselves.
//
// Pure logic only (no database, no Capacitor), so it can be tested in Node.

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The widget's list: this device's My Location first (it is what the widget showed before, and what a phone
 * user means by "my weather"), then the saved cities in their display order.
 *
 * My Location's coordinates are rounded to ~100 m. A GPS fix wobbles in the last decimals on every reading,
 * and every distinct list would otherwise trigger a fresh widget refresh (a request to the weather provider).
 */
export function placesForWidget({ cities = [], hereCity = null } = {}) {
  const places = [];
  if (hereCity && Number.isFinite(hereCity.latitude) && Number.isFinite(hereCity.longitude)) {
    places.push({
      id: hereCity.id,
      name: hereCity.name,
      latitude: round3(hereCity.latitude),
      longitude: round3(hereCity.longitude),
      isPin: true,
    });
  }
  for (const c of cities) {
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;
    places.push({ id: c.id, name: c.name, latitude: c.latitude, longitude: c.longitude, isPin: false });
  }
  return places;
}

/**
 * Follows the app's data and pushes the widget's list when — and only when — it actually changed, after a short
 * quiet period (adding three cities in a row, or a GPS fix landing next to a language change, is one push).
 *
 * @param subscribe  (onState) => unsubscribe     onState({cities, hereCity, units}) on every change of the data
 * @param push       ({cities: [...], units}) => void
 * @returns          a function that stops following (and cancels a push that is still waiting)
 */
export function watchWidgetPlaces({ subscribe, push, delayMs = 800, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let lastPushed = null;
  let timer = null;

  const unsubscribe = subscribe((state) => {
    const payload = {
      cities: placesForWidget(state),
      units: state.units === 'imperial' ? 'imperial' : 'metric',
    };
    const key = JSON.stringify(payload);
    clearTimer(timer);
    timer = null;
    if (key === lastPushed) return;
    timer = setTimer(() => {
      timer = null;
      lastPushed = key;
      push(payload);
    }, delayMs);
  });

  return () => {
    clearTimer(timer);
    timer = null;
    unsubscribe?.();
  };
}
