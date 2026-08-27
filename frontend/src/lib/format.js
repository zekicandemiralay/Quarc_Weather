// Display helpers. The backend already returns values in the user's chosen
// units, so nothing here converts — it only formats and labels.

export const round = (n) => (n === null || n === undefined || Number.isNaN(n) ? '--' : Math.round(n));

export function temp(n) {
  return `${round(n)}°`;
}

/** Local time in the *city's* timezone, not the viewer's. */
export function hourIn(iso, timezone, locale = 'en') {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: timezone }).format(new Date(iso));
  } catch {
    return new Date(iso).getHours() + '';
  }
}

export function timeIn(iso, timezone, locale = 'en') {
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(
      new Date(iso)
    );
  } catch {
    return '--:--';
  }
}

export function weekdayIn(iso, timezone, locale = 'en') {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: timezone }).format(new Date(iso));
  } catch {
    return '';
  }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function windDirection(deg) {
  if (deg === null || deg === undefined) return '--';
  return COMPASS[Math.round(deg / 22.5) % 16];
}

/**
 * European AQI bands (Open-Meteo's `european_aqi`). Returns a band key for
 * i18n plus a colour for the meter.
 */
export function aqiBand(value) {
  if (value === null || value === undefined) return { key: 'unknown', color: '#9ca3af', pct: 0 };
  if (value <= 20) return { key: 'good', color: '#22c55e', pct: value / 100 };
  if (value <= 40) return { key: 'fair', color: '#84cc16', pct: value / 100 };
  if (value <= 60) return { key: 'moderate', color: '#eab308', pct: value / 100 };
  if (value <= 80) return { key: 'poor', color: '#f97316', pct: value / 100 };
  if (value <= 100) return { key: 'veryPoor', color: '#ef4444', pct: value / 100 };
  return { key: 'extremelyPoor', color: '#a21caf', pct: 1 };
}

export function uvBand(value) {
  if (value === null || value === undefined) return { key: 'unknown', color: '#9ca3af' };
  if (value < 3) return { key: 'low', color: '#22c55e' };
  if (value < 6) return { key: 'moderate', color: '#eab308' };
  if (value < 8) return { key: 'high', color: '#f97316' };
  if (value < 11) return { key: 'veryHigh', color: '#ef4444' };
  return { key: 'extreme', color: '#a21caf' };
}

/** Fraction (0..1) of a value's position inside a min/max range, clamped. */
export function ratio(value, min, max) {
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function relativeTime(ts, locale = 'en') {
  const mins = Math.round((Date.now() - ts) / 60000);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (mins < 60) return rtf.format(-mins, 'minute');
    return rtf.format(-Math.round(mins / 60), 'hour');
  } catch {
    return `${mins}m`;
  }
}
