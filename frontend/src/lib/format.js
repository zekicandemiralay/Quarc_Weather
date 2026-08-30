// Display helpers. The backend already returns values in the user's chosen
// units, so nothing here converts — it only formats and labels.

export const round = (n) => (n === null || n === undefined || Number.isNaN(n) ? '--' : Math.round(n));

export function temp(n) {
  return `${round(n)}°`;
}

/**
 * Open-Meteo's hourly/daily timestamps (fetched with timezone=auto) are
 * already the target city's own wall-clock time, written with no UTC/offset
 * marker — "2026-08-30T13:00", or just "2026-08-30" for daily-only values.
 *
 * Constructing a Date from a string like that and then formatting it with
 * an explicit timeZone option double-applies a timezone conversion: Date()
 * first reads the naive string as local to *this device*, then Intl
 * reformats that (already-shifted) instant into the target city's zone.
 * The two steps only cancel out when the viewer's own UTC offset happens to
 * match the city's — which is not guaranteed, and was quietly wrong
 * whenever it didn't (e.g. a Berlin-based viewer checking Istanbul showed
 * every hour one hour off). Parsing the string's own digits directly
 * sidesteps the problem entirely — nothing about "what hour does this
 * string say" needs a timezone lookup at all; the string already says it.
 */
function parseWallClock(iso) {
  const [datePart, timePart] = String(iso).split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = (timePart || '00:00').split(':').map(Number);
  return { y, m, d, h: h || 0, min: min || 0 };
}

/** The hour an Open-Meteo wall-clock timestamp says, zero-padded ("13", "00"). */
export function wallClockHour(iso) {
  return String(parseWallClock(iso).h).padStart(2, '0');
}

/** "HH:mm" an Open-Meteo wall-clock timestamp says, verbatim — no timezone
 *  math, see parseWallClock above for why. */
export function wallClockTime(iso) {
  const { h, min } = parseWallClock(iso);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Weekday name for an Open-Meteo wall-clock date. Anchored at UTC purely as
 *  a locale-aware weekday-name lookup device — the Y/M/D triplet alone
 *  determines the weekday, so pinning it at UTC never risks shifting it
 *  across a day boundary the way constructing a real-timezone-aware Date
 *  from the same triplet could. */
export function weekdayFor(iso, locale = 'en') {
  const { y, m, d } = parseWallClock(iso);
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
  } catch {
    return '';
  }
}

/**
 * The real current time in a given IANA timezone, "HH:mm" — for "what time
 * is it right now in city X" (Cities.jsx's card subtitle). Unlike the
 * wallClock* helpers above, this one's input is a genuine instant (`new
 * Date()`), so converting it via an explicit timeZone is exactly correct —
 * there's no naive-string ambiguity to sidestep here. Always 24-hour,
 * regardless of locale: hourCycle: 'h23' (not hour12: false) is deliberate
 * — h23 unambiguously renders midnight as "00", where hour12: false alone
 * has inconsistently rendered "24" on some JS engines. This app runs across
 * several (Android WebView, Tauri's WebView2, desktop browsers), so pin the
 * exact behavior rather than lean on a default.
 */
export function nowInTimezone(timezone, locale = 'en') {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(new Date());
  } catch {
    return '--:--';
  }
}

/**
 * The current hour, expressed as a "YYYY-MM-DDTHH:00" wall-clock string in
 * the given timezone — for finding "which hourly.time entry is the current
 * one" by plain string comparison, since Open-Meteo's own entries share
 * that exact shape and sort correctly as strings (no Date object, no
 * naive-string reinterpretation risk — see parseWallClock above for why
 * that matters). en-CA is used only as a reliable YYYY-MM-DD formatter;
 * the parts are reassembled by hand so the result never depends on a
 * locale's own separator/ordering choices.
 */
export function currentHourWallClock(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:00`;
  } catch {
    return null;
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
