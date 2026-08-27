// Moon phase. Open-Meteo doesn't provide it and it needs no network call —
// the synodic month is regular enough that a reference new moon plus modular
// arithmetic is accurate to well under a day, which is all the UI shows.

const SYNODIC_MONTH = 29.530588853; // days
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // 2000-01-06 18:14 UTC

const PHASES = [
  { key: 'new', max: 0.0225 },
  { key: 'waxing_crescent', max: 0.2275 },
  { key: 'first_quarter', max: 0.2725 },
  { key: 'waxing_gibbous', max: 0.4775 },
  { key: 'full', max: 0.5225 },
  { key: 'waning_gibbous', max: 0.7275 },
  { key: 'last_quarter', max: 0.7725 },
  { key: 'waning_crescent', max: 0.9775 },
  { key: 'new', max: 1.0001 },
];

/**
 * @returns {{ phase: string, fraction: number, illumination: number }}
 *   fraction — 0 at new moon, 0.5 at full, approaching 1 back at new.
 *   illumination — 0..1 lit portion of the disc.
 */
function moonPhase(date = new Date()) {
  const days = (date.getTime() - REFERENCE_NEW_MOON) / 86400000;
  let fraction = (days % SYNODIC_MONTH) / SYNODIC_MONTH;
  if (fraction < 0) fraction += 1;

  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  const phase = PHASES.find((p) => fraction < p.max).key;

  return {
    phase,
    fraction: Number(fraction.toFixed(4)),
    illumination: Number(illumination.toFixed(4)),
    age_days: Number((fraction * SYNODIC_MONTH).toFixed(2)),
  };
}

module.exports = { moonPhase };
