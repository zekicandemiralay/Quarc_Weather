// Helpers for Open-Meteo's NAIVE local wall-clock strings ("2026-08-30T14:00" —
// no UTC offset, always the *city's* own clock). Never run these through
// `new Date(iso)`: that reads the digits as THIS DEVICE's zone and shifts every
// hour by the gap between the device and the city. Compare them as strings, or
// do arithmetic on them anchored at UTC (which never observes DST).

/**
 * What "this hour" looks like as the same kind of naive string, in the given
 * IANA timezone — so it can be compared directly against `hourly.time[i]`.
 * en-CA is used only as a reliable YYYY-MM-DD formatter; the parts are
 * reassembled by hand so the result never depends on a locale's separators.
 */
export function currentHourWallClock(timezone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:00`;
  } catch {
    return null;
  }
}

/** Adds whole hours to a naive wall-clock string, purely as calendar maths. */
export function addHours(iso, hours) {
  const [datePart, timePart = '00:00'] = String(iso).split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, min) + hours * 3600000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
