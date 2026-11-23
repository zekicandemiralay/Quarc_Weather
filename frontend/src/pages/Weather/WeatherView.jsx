import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db, here, forecasts } from '../../lib/localData';
import { HERE_ID } from '../../lib/here';
import usePullToRefresh from '../../lib/usePullToRefresh';
import { labelKey, iconFor, skyFor, skyBucketFor } from '../../lib/weatherCodes';
import { round, relativeTime } from '../../lib/format';
import { setLastOpenedCity } from '../../lib/lastOpened';
import { offerWidgetPin } from '../../lib/widgetBridge';
import useAuthStore from '../../store/authStore';
import WeatherIcon from '../../components/WeatherIcon';
import WeatherEffects from '../../components/WeatherEffects';
import RadarMap from '../../components/RadarMap';
import HourlyStrip from './HourlyStrip';
import DailyList from './DailyList';
import DetailGrid from './DetailGrid';
import AlertsCard from './AlertsCard';

// Coming back to the app within this window doesn't re-fetch — the weather
// provider only refreshes its forecast every few minutes anyway, and a fetch on
// every tab switch is wasted battery and data.
const FOREGROUND_REFRESH_MIN_MS = 60 * 1000;

export default function WeatherView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id);

  const [city, setCity] = useState(null);
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(null); // timestamp when showing cached data
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);
  const pullRef = useRef(null);
  const lastFetchRef = useRef(0);
  const hasDataRef = useRef(false); // read inside load() without making it re-create on every data change
  const [scrolled, setScrolled] = useState(false);

  // The city comes from the local database ('here' is this device's My Location) and its forecast from the local
  // cache or, when that is stale, straight from the weather provider — no Quarc server involved, so this works the
  // same with Tailscale off. If the provider can't be reached either, the last good copy is shown, flagged stale.
  const load = useCallback(
    async ({ spinner = true, force = false } = {}) => {
      if (spinner) setLoading(true);
      setError('');
      let painted = null; // what we managed to show from the cache while the fresh answer is awaited
      try {
        // Pull-to-refresh on My Location also takes a new GPS fix (keeps the last known one if there is none).
        if (force && id === HERE_ID) await here.refresh({ language: i18n.language, timeout: 8000 });

        const found = id === HERE_ID ? here.asCity(await here.get()) : await db.cities.get(id);
        const c = found && !found.is_deleted ? found : null;
        if (!c) {
          // The city was removed (maybe on another device) — nothing to show.
          navigate('/', { replace: true });
          return;
        }
        setCity(c);
        setLastOpenedCity(userId, id);

        // Paint instantly from whatever is cached; the fresh forecast replaces it a moment later.
        if (!hasDataRef.current) {
          painted = await forecasts.peek(c);
          if (painted) {
            hasDataRef.current = true;
            setData(painted.data);
          }
        }

        const result = await forecasts.get(c, { force });
        lastFetchRef.current = Date.now();
        hasDataRef.current = true;
        setData(result.data);
        setStale(result.stale ? result.at : null);
        // First moment real, live weather has actually been shown — the
        // natural point to offer the home-screen widget, rather than
        // immediately on login before the user has seen the app do
        // anything. offerWidgetPin() itself only ever asks once.
        if (!result.stale) offerWidgetPin();
      } catch (err) {
        if (painted) setStale(painted.at); // refresh failed, but there is something to show
        else if (!hasDataRef.current) setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, navigate, userId, i18n.language]
  );

  useEffect(() => {
    hasDataRef.current = false; // a different city (or a fresh mount): nothing on screen belongs to it yet
    load();
  }, [load]);

  // Refresh when the app comes back to the foreground — the common case on
  // phones, where the screen may have been backgrounded for hours.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchRef.current < FOREGROUND_REFRESH_MIN_MS) return;
      load({ spinner: false });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  usePullToRefresh(scrollRef, pullRef, () => load({ spinner: false, force: true }), !!data);

  const current = data?.current;
  const isDay = current?.is_day === 1;
  const code = current?.weather_code ?? 3;
  const skyMood = skyBucketFor(code, current?.temperature_2m);

  // Drive the gradient through CSS variables so it cross-fades on change.
  useEffect(() => {
    if (!current) return;
    const [a, b, c] = skyFor(code, isDay, current.temperature_2m);
    const root = document.documentElement;
    root.style.setProperty('--sky-a', a);
    root.style.setProperty('--sky-b', b);
    root.style.setProperty('--sky-c', c);
  }, [code, isDay, current]);

  if (loading && !data) {
    return <div className="sky flex h-screen items-center justify-center text-white/80">{t('app.loading')}</div>;
  }

  if (error && !data) {
    return (
      <div className="sky flex h-screen flex-col items-center justify-center gap-4 px-8 text-center text-white">
        <p className="text-sm text-white/80">{error}</p>
        <button onClick={() => load()} className="glass-strong px-5 py-2 text-sm font-medium">
          {t('app.retry')}
        </button>
        <button onClick={() => navigate('/')} className="text-sm text-white/60 underline">
          {t('cities.title')}
        </button>
      </div>
    );
  }

  const todayIdx = 1; // past_days=1 shifts today to index 1
  const hi = data?.daily?.temperature_2m_max?.[todayIdx];
  const lo = data?.daily?.temperature_2m_min?.[todayIdx];

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 140)}
      className="sky h-screen overflow-y-auto overscroll-y-contain text-white"
    >
      {current && <WeatherEffects sky={skyMood} isDay={isDay} />}

      {/* Pull-to-refresh indicator — positioned/animated imperatively by
          usePullToRefresh (no React state, so pulling never re-renders the
          animated background). Hidden until pulled. */}
      <div
        ref={pullRef}
        aria-hidden="true"
        className="pointer-events-none fixed left-1/2 top-14 z-30 opacity-0"
        style={{ transform: 'translate(-50%, 0px)' }}
      >
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="rounded-full bg-black/30 p-1 backdrop-blur"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </svg>
      </div>

      {/* Compact header that fades in once the hero scrolls away. */}
      <header
        className={`safe-top sticky top-0 z-20 flex items-center justify-between px-4 py-3 transition-colors ${
          scrolled ? 'border-b border-white/10 bg-black/25 backdrop-blur-xl' : ''
        }`}
      >
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-sm font-medium text-white/90">
          <span className="text-lg leading-none">‹</span> {t('cities.title')}
        </button>
        {scrolled && (
          <div className="text-center">
            <p className="text-sm font-semibold leading-tight">
              {!!city?.is_current_location && '📍 '}
              {city?.name}
            </p>
            <p className="text-xs text-white/70">
              {round(current?.temperature_2m)}° · {t(labelKey(code))}
            </p>
          </div>
        )}
        <button onClick={() => navigate('/settings')} className="text-lg text-white/80" aria-label={t('settings.title')}>
          ⚙
        </button>
      </header>

      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        {/* Hero */}
        <div className="flex flex-col items-center pb-6 pt-4 text-center">
          <h1 className="flex items-center gap-1.5 text-[26px] font-medium tracking-tight">
            {/* !! coerces to a real boolean — is_current_location comes back
                from SQLite as the integer 0/1, and `{0 && <X/>}` in JSX
                renders the literal "0" as text instead of nothing. */}
            {!!city?.is_current_location && (
              <span aria-label={t('cities.myLocation')} title={t('cities.myLocation')} className="text-lg">
                📍
              </span>
            )}
            {city?.name}
          </h1>
          {city?.admin1 && city.admin1 !== city.name && (
            <p className="text-sm text-white/70">
              {city.admin1}
              {city.country ? `, ${city.country}` : ''}
            </p>
          )}

          <div className="mt-2 flex items-start">
            <span className="text-[86px] font-thin leading-none tracking-tighter">
              {round(current?.temperature_2m)}
            </span>
            <span className="mt-3 text-4xl font-thin text-white/80">°</span>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <WeatherIcon icon={iconFor(code, isDay)} size={30} />
            <p className="text-lg font-medium text-white/90">{t(labelKey(code))}</p>
          </div>

          <p className="mt-1 text-sm font-medium text-white/80">
            {t('weather.high')}:{round(hi)}° · {t('weather.low')}:{round(lo)}°
          </p>

          {stale && (
            <p className="mt-3 rounded-full bg-black/25 px-3 py-1 text-xs text-white/80">
              {t('app.offline')} · {relativeTime(stale, i18n.language)}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {/* Alerts are computed when the forecast is fetched and describe
              windows relative to that moment — so they're only shown for live
              data, never for an offline copy that may be hours old. */}
          {!stale && <AlertsCard alerts={data?.alerts} todayDate={data?.daily?.time?.[todayIdx]} />}

          <HourlyStrip hourly={data?.hourly} timezone={data?.timezone} daily={data?.daily} />

          <DailyList daily={data?.daily} currentTemp={current?.temperature_2m} />

          {city && <RadarMap latitude={city.latitude} longitude={city.longitude} timezone={data?.timezone} />}

          <DetailGrid
            current={current}
            currentUnits={data?.current_units}
            daily={data?.daily}
            dailyUnits={data?.daily_units}
            air={data?.air_quality}
            moon={data?.moon}
            latitude={city?.latitude}
          />

          <p className="pt-2 text-center text-[11px] text-white/50">
            Open-Meteo · {data?.timezone}
            {data?.fetched_at && !stale ? ` · ${t('app.updatedAt', { time: relativeTime(data.fetched_at, i18n.language) })}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
