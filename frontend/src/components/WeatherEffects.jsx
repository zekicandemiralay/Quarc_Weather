import { useMemo } from 'react';

/**
 * A fixed, full-viewport, pointer-events-none particle layer behind the
 * cards, giving each sky mood its own subtle motion — the thing that makes
 * Apple Weather feel alive instead of static. Driven by the same `sky`
 * bucket (clear/partly/cloudy/fog/rain/snow/storm/hot) skyFor() already
 * uses for the gradient, so it stays in lockstep with the background
 * automatically and needs no separate weather-code mapping of its own.
 *
 * Pure CSS keyframe animations, not JS/rAF — `prefers-reduced-motion` in
 * index.css already clamps every animation-duration globally, so this
 * layer is accessible for free rather than needing its own opt-out logic.
 * Particle positions/timings are randomized once per mount via useMemo,
 * not re-rolled on every render.
 */
export default function WeatherEffects({ sky, isDay }) {
  // `hot` is just a warm-tinted variant of `clear` (skyFor() only swaps in
  // `hot` when the base bucket was already `clear`) — same rays/stars fit.
  const effectSky = sky === 'hot' ? 'clear' : sky;

  const rain = useMemo(
    () => makeRain(effectSky === 'storm' ? 55 : effectSky === 'rain' ? 40 : 0),
    [effectSky]
  );
  const snow = useMemo(() => makeSnow(effectSky === 'snow' ? 34 : 0), [effectSky]);
  const stars = useMemo(() => (effectSky === 'clear' && !isDay ? makeStars(55) : []), [effectSky, isDay]);
  const fog = useMemo(() => (effectSky === 'fog' ? makeFog(4) : []), [effectSky]);
  const clouds = useMemo(
    () => (effectSky === 'partly' || effectSky === 'cloudy' ? makeClouds(effectSky === 'cloudy' ? 4 : 2) : []),
    [effectSky]
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {effectSky === 'clear' && isDay && <div className="weather-sun-glow" />}

      {stars.map((s) => (
        <span key={s.key} className="weather-star" style={s.style} />
      ))}

      {clouds.map((c) => (
        <span key={c.key} className="weather-cloud" style={c.style} />
      ))}

      {fog.map((f) => (
        <span key={f.key} className="weather-fog-band" style={f.style} />
      ))}

      {rain.map((r) => (
        <span key={r.key} className="weather-raindrop" style={r.style} />
      ))}

      {snow.map((s) => (
        <span key={s.key} className="weather-snowflake" style={s.style} />
      ))}

      {effectSky === 'storm' && <div className="weather-lightning" />}
    </div>
  );
}

// Each `make*` helper returns fixed-length arrays of { key, style } so the
// list only needs to be built once and can render as plain spans. Random
// values are seeded per-particle, not per-frame — the CSS keyframes handle
// the actual motion.

function makeRain(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `r${i}`,
    style: {
      left: `${Math.random() * 100}%`,
      animationDuration: `${0.4 + Math.random() * 0.35}s`,
      animationDelay: `${Math.random() * 2}s`,
      opacity: 0.25 + Math.random() * 0.35,
      height: `${14 + Math.random() * 12}px`,
    },
  }));
}

function makeSnow(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `s${i}`,
    style: {
      left: `${Math.random() * 100}%`,
      animationDuration: `${6 + Math.random() * 6}s`,
      animationDelay: `${Math.random() * 8}s`,
      opacity: 0.35 + Math.random() * 0.45,
      width: `${3 + Math.random() * 4}px`,
      height: `${3 + Math.random() * 4}px`,
    },
  }));
}

function makeStars(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `t${i}`,
    style: {
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 55}%`,
      animationDuration: `${1.8 + Math.random() * 2.5}s`,
      animationDelay: `${Math.random() * 4}s`,
      width: `${1 + Math.random() * 1.5}px`,
      height: `${1 + Math.random() * 1.5}px`,
    },
  }));
}

function makeFog(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `f${i}`,
    style: {
      top: `${10 + i * 22}%`,
      animationDuration: `${14 + Math.random() * 8}s`,
      animationDelay: `${-Math.random() * 10}s`,
      opacity: 0.12 + Math.random() * 0.1,
    },
  }));
}

function makeClouds(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: `c${i}`,
    style: {
      top: `${5 + Math.random() * 30}%`,
      animationDuration: `${40 + Math.random() * 30}s`,
      animationDelay: `${-Math.random() * 40}s`,
      opacity: 0.1 + Math.random() * 0.12,
      transform: `scale(${0.8 + Math.random() * 0.9})`,
    },
  }));
}
