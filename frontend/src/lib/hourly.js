// Pure logic behind the hourly strip, kept out of the component so it can be
// unit-tested without a browser.
//
// Everything here compares Open-Meteo's naive wall-clock strings
// ("YYYY-MM-DDTHH:mm", the city's own clock) as plain strings — see
// format.js's parseWallClock for why a Date object must never be involved.

/**
 * Builds the cells of the strip: the next `count` hours starting at the current
 * hour, with every sunrise/sunset that falls inside that window slotted in
 * between the hours (the way Apple's strip marks where the day turns over).
 *
 * `hourly.time` starts at yesterday's midnight (past_days=1), so the window has
 * to be found by timestamp rather than assumed to start at index 0. Sunrise and
 * sunset are taken from the whole `daily` block — not just today's — because
 * after sunset the 24-hour window runs into tomorrow, and tomorrow's sunrise
 * is exactly the marker you want to see then.
 *
 * @returns Array<{ kind: 'hour', iso, index, isNow } | { kind: 'sunrise'|'sunset', iso }>
 */
export function buildHourlyCells({ hourly, daily, nowHour, count = 24 }) {
  if (!hourly?.time?.length) return [];

  const start = Math.max(0, hourly.time.findIndex((iso) => !nowHour || iso >= nowHour));
  const slice = hourly.time.slice(start, start + count);
  if (!slice.length) return [];

  const cells = slice.map((iso, i) => ({ kind: 'hour', iso, index: start + i, isNow: i === 0 }));

  const events = [];
  for (const kind of ['sunrise', 'sunset']) {
    for (const iso of daily?.[kind] || []) {
      if (iso && iso >= slice[0] && iso <= slice[slice.length - 1]) events.push({ kind, iso });
    }
  }
  events.sort((a, b) => a.iso.localeCompare(b.iso));

  // Insert back-to-front so earlier insertions don't shift the positions the
  // later ones were computed against.
  for (const ev of events.reverse()) {
    const at = cells.findIndex((c) => c.kind === 'hour' && c.iso > ev.iso);
    if (at >= 0) cells.splice(at, 0, ev);
    else cells.push(ev); // after the final hour of the window
  }

  return cells;
}
