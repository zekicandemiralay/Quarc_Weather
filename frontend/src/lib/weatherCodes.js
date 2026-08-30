// WMO 4677 weather interpretation codes — the vocabulary Open-Meteo speaks.
// Each code maps to a translation key, an icon id, and a "sky" id. The sky is
// what drives the full-screen gradient: it collapses ~30 codes into 8 moods so
// the background stays calm rather than flickering between near-identical
// blues every time the code shifts from 1 to 2.

export const SKY = {
  clear: {
    day: ['#3b82f6', '#60a5fa', '#93c5fd'],
    night: ['#0f172a', '#1e293b', '#334155'],
  },
  partly: {
    day: ['#3f7fc1', '#6ba3d6', '#a8c8e5'],
    night: ['#111827', '#1f2937', '#374151'],
  },
  cloudy: {
    day: ['#5c7086', '#7d8fa3', '#a3b1bf'],
    night: ['#0f1419', '#1c2530', '#2d3748'],
  },
  fog: {
    day: ['#6b7280', '#9ca3af', '#c4c9d0'],
    night: ['#111418', '#1f242b', '#333a42'],
  },
  rain: {
    day: ['#37506b', '#4a6b8a', '#6b8aa8'],
    night: ['#0a0f16', '#151d28', '#232f3d'],
  },
  snow: {
    day: ['#647d99', '#8ba3bd', '#c2d1de'],
    night: ['#131a24', '#212b38', '#333f4f'],
  },
  storm: {
    day: ['#2a2f3d', '#414859', '#5a6275'],
    night: ['#07090d', '#121620', '#1e2430'],
  },
  hot: {
    day: ['#c2571a', '#e07b2c', '#f0a35c'],
    night: ['#1a1008', '#2b1b0e', '#3d2818'],
  },
};

const CODES = {
  0: { key: 'clear', icon: 'sun', sky: 'clear' },
  1: { key: 'mainlyClear', icon: 'sun-cloud', sky: 'clear' },
  2: { key: 'partlyCloudy', icon: 'cloud-sun', sky: 'partly' },
  3: { key: 'overcast', icon: 'cloud', sky: 'cloudy' },
  45: { key: 'fog', icon: 'fog', sky: 'fog' },
  48: { key: 'rimeFog', icon: 'fog', sky: 'fog' },
  51: { key: 'drizzleLight', icon: 'drizzle', sky: 'rain' },
  53: { key: 'drizzleModerate', icon: 'drizzle', sky: 'rain' },
  55: { key: 'drizzleDense', icon: 'drizzle', sky: 'rain' },
  56: { key: 'freezingDrizzleLight', icon: 'sleet', sky: 'snow' },
  57: { key: 'freezingDrizzleDense', icon: 'sleet', sky: 'snow' },
  61: { key: 'rainSlight', icon: 'rain', sky: 'rain' },
  63: { key: 'rainModerate', icon: 'rain', sky: 'rain' },
  65: { key: 'rainHeavy', icon: 'rain-heavy', sky: 'rain' },
  66: { key: 'freezingRainLight', icon: 'sleet', sky: 'snow' },
  67: { key: 'freezingRainHeavy', icon: 'sleet', sky: 'snow' },
  71: { key: 'snowSlight', icon: 'snow', sky: 'snow' },
  73: { key: 'snowModerate', icon: 'snow', sky: 'snow' },
  75: { key: 'snowHeavy', icon: 'snow-heavy', sky: 'snow' },
  77: { key: 'snowGrains', icon: 'snow', sky: 'snow' },
  80: { key: 'showersSlight', icon: 'showers', sky: 'rain' },
  81: { key: 'showersModerate', icon: 'showers', sky: 'rain' },
  82: { key: 'showersViolent', icon: 'rain-heavy', sky: 'storm' },
  85: { key: 'snowShowersSlight', icon: 'snow', sky: 'snow' },
  86: { key: 'snowShowersHeavy', icon: 'snow-heavy', sky: 'snow' },
  95: { key: 'thunderstorm', icon: 'storm', sky: 'storm' },
  96: { key: 'thunderstormHail', icon: 'storm-hail', sky: 'storm' },
  99: { key: 'thunderstormHailHeavy', icon: 'storm-hail', sky: 'storm' },
};

const UNKNOWN = { key: 'unknown', icon: 'cloud', sky: 'cloudy' };

export function describe(code) {
  return CODES[code] ?? UNKNOWN;
}

/** i18n key for a weather code, e.g. 'weather.partlyCloudy'. */
export function labelKey(code) {
  return `weather.${describe(code).key}`;
}

export function iconFor(code, isDay = true) {
  const { icon } = describe(code);
  // Only the clear/near-clear icons have a distinct night form; a rain cloud
  // looks the same at 3am as at 3pm.
  if (!isDay) {
    if (icon === 'sun') return 'moon';
    if (icon === 'sun-cloud') return 'moon-cloud';
    if (icon === 'cloud-sun') return 'cloud-moon';
  }
  return icon;
}

/**
 * Which of the 8 SKY moods a code/temperature combination resolves to.
 * `hot` overrides clear-sky blue once it's genuinely scorching, which is the
 * one case where Apple's app also shifts to warm tones. Exposed on its own
 * (not just baked into skyFor) so other consumers — the animated background
 * particle layer — can key off the same mood without duplicating the
 * hot-override rule.
 */
export function skyBucketFor(code, tempC = null) {
  const { sky } = describe(code);
  return sky === 'clear' && tempC !== null && tempC >= 32 ? 'hot' : sky;
}

/**
 * The three-stop gradient behind a city screen.
 */
export function skyFor(code, isDay = true, tempC = null) {
  const bucket = skyBucketFor(code, tempC);
  return SKY[bucket][isDay ? 'day' : 'night'];
}

export function gradientCss(code, isDay = true, tempC = null) {
  const [a, b, c] = skyFor(code, isDay, tempC);
  return `linear-gradient(180deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
}
