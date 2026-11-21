// Presentation helpers for the forecast-based heads-up card (see the backend's
// services/alerts.js). Pure functions so they can be unit-tested: alert
// `start`/`end` are naive city wall-clock strings, and "today" is the city's
// own date (daily.time[1]), never the viewer's.

const pad = (n) => String(n).padStart(2, '0');

/** Date string `n` days after a "YYYY-MM-DD" date, as pure calendar maths. */
export function shiftDate(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * Builds the time-window text for one alert:
 *   ongoing  -> "Now – 18:00"
 *   later    -> "14:00 – 18:00", "Tomorrow 02:00 – 06:00", "Tue 23:00 – Wed 02:00"
 * A day label is only added when the date isn't today, and on the end time only
 * when it falls on a different day from the start.
 *
 * @param labels { now, tomorrow, weekday(iso) }
 */
export function formatAlertWindow(alert, todayDate, labels) {
  const dayOf = (iso) => iso.slice(0, 10);
  const timeOf = (iso) => iso.slice(11, 16);
  const dayLabel = (iso) => {
    const d = dayOf(iso);
    if (d === todayDate) return '';
    if (d === shiftDate(todayDate, 1)) return labels.tomorrow;
    return labels.weekday(iso);
  };
  const join = (...parts) => parts.filter(Boolean).join(' ');

  const startText = alert.ongoing ? labels.now : join(dayLabel(alert.start), timeOf(alert.start));
  const compareDay = alert.ongoing ? todayDate : dayOf(alert.start);
  const endDayLabel = dayOf(alert.end) !== compareDay ? dayLabel(alert.end) : '';

  return `${startText} – ${join(endDayLabel, timeOf(alert.end))}`;
}

/** Emoji shown beside each alert type. */
export const ALERT_ICONS = {
  thunderstorm: '⛈️',
  heavy_rain: '🌧️',
  strong_wind: '💨',
  heavy_snow: '❄️',
  freezing_rain: '🧊',
  heat: '🥵',
  cold: '🥶',
  uv: '☀️',
  dense_fog: '🌫️',
};
