import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';

// RainViewer's public radar API — free, no key, CORS-open (verified against
// the real endpoint: https://api.rainviewer.com/public/weather-maps.json).
// Tile URL grammar per https://www.rainviewer.com/api.html:
//   {host}{path}/{size}/{z}/{x}/{y}/{color}/{options}.png
// color=2 is RainViewer's "Universal Blue" scheme; options "1_1" means
// smoothed + snow shown in a distinct color.
const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const TILE_SIZE = 256;
const COLOR_SCHEME = 2;
const TILE_OPTIONS = '1_1';

// Esri's free "World Dark Gray Canvas" — genuinely keyless (verified by
// downloading and looking at actual tile pixels, not just the HTTP status —
// CartoDB's equivalent free dark basemap turned out to now stamp an "API
// KEY REQUIRED" watermark across every tile despite still answering 200).
// Two stacked layers, same as Esri's own docs pair them: a plain gray
// canvas, then place-name labels on top of it as a separate transparent layer.
const BASEMAP_BASE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const BASEMAP_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const BASEMAP_ATTRIBUTION = 'Esri, HERE, Garmin &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const FRAME_MS = 600;
const PAST_FRAMES = 8;
const FORECAST_FRAMES = 3;

/**
 * A collapsed-by-default radar card. Nothing — no map, no tile requests —
 * loads until the user actually taps to expand it, since map tiles are a
 * real bandwidth cost most city views shouldn't pay for by default.
 */
export default function RadarMap({ latitude, longitude, timezone }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="glass overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
        aria-expanded={expanded}
      >
        <h2 className="card-label">{t('weather.radar')}</h2>
        <span className={`text-white/60 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {expanded && (
        <RadarCanvas latitude={latitude} longitude={longitude} timezone={timezone} locale={i18n.language} />
      )}
    </section>
  );
}

function RadarCanvas({ latitude, longitude, timezone, locale }) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const radarLayerRef = useRef(null);

  const [frames, setFrames] = useState([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  // Create the map once, on mount. Torn down on unmount (i.e. whenever the
  // card is collapsed again, since the parent stops rendering this
  // component entirely) rather than left running in the background.
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 7,
      minZoom: 3,
      maxZoom: 11,
    });
    mapRef.current = map;

    L.tileLayer(BASEMAP_BASE_URL, { maxZoom: 11, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
    L.tileLayer(BASEMAP_LABELS_URL, { maxZoom: 11 }).addTo(map);

    L.marker([latitude, longitude], {
      icon: L.divIcon({ className: '', html: '<span class="radar-city-dot"></span>', iconSize: [14, 14], iconAnchor: [7, 7] }),
      interactive: false,
    }).addTo(map);

    let cancelled = false;
    fetch(RAINVIEWER_INDEX)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const past = data?.radar?.past || [];
        const nowcast = data?.radar?.nowcast || [];
        const chosen = [...past.slice(-PAST_FRAMES), ...nowcast.slice(0, FORECAST_FRAMES)];
        if (!chosen.length) {
          setStatus('error');
          return;
        }
        const built = chosen.map((f) => ({
          time: f.time,
          isForecast: nowcast.includes(f),
          url: `${data.host}${f.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTIONS}.png`,
        }));
        setFrames(built);
        // Start on the most recent PAST frame ("now"), not frame 0 — the
        // loop then plays forward through it into the forecast frames.
        setFrameIndex(Math.max(0, past.length ? Math.min(PAST_FRAMES, past.length) - 1 : 0));
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
    // Deliberately mount-once: the card unmounts entirely on collapse, so a
    // fresh RadarCanvas (and fresh radar data) is what remounting means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paint whichever frame is current whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    const frame = frames[frameIndex];
    if (!map || !frame) return;
    const next = L.tileLayer(frame.url, { opacity: 0.75, zIndex: 10 });
    next.addTo(map);
    const prev = radarLayerRef.current;
    radarLayerRef.current = next;
    // Remove the previous frame only after the new one has painted in, so
    // the animation doesn't visibly flash to an empty map between frames.
    if (prev) next.once('load', () => map.removeLayer(prev));
  }, [frames, frameIndex]);

  // Autoplay.
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = setInterval(() => setFrameIndex((i) => (i + 1) % frames.length), FRAME_MS);
    return () => clearInterval(id);
  }, [playing, frames.length]);

  const frame = frames[frameIndex];
  const frameLabel = frame
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(
        new Date(frame.time * 1000)
      )
    : '';

  return (
    <div className="px-4 pb-4">
      <div className="relative h-64 overflow-hidden rounded-xl">
        <div ref={containerRef} className="h-full w-full" />
        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 text-sm text-white/80">
            {t('app.loading')}
          </div>
        )}
        {status === 'error' && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/80">{t('weather.radarUnavailable')}</span>
          </div>
        )}
      </div>

      {frames.length > 1 && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => setPlaying((v) => !v)}
            className="glass-strong flex h-8 w-8 shrink-0 items-center justify-center text-sm"
            aria-label={playing ? t('weather.radarPause') : t('weather.radarPlay')}
          >
            {playing ? '❙❙' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={frameIndex}
            onChange={(e) => {
              setPlaying(false);
              setFrameIndex(Number(e.target.value));
            }}
            className="h-1 flex-1 accent-white"
          />
          <span className="w-24 shrink-0 text-right text-xs text-white/70">
            {frame?.isForecast ? `${t('weather.radarForecast')} ` : ''}
            {frameLabel}
          </span>
        </div>
      )}
    </div>
  );
}
