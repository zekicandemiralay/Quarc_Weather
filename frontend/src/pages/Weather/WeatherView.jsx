import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listCities, getWeather, cacheWeather, readCachedWeather } from '../../lib/api';
import { labelKey, iconFor, skyFor } from '../../lib/weatherCodes';
import { round, relativeTime } from '../../lib/format';
import { setLastOpenedCity } from '../../lib/lastOpened';
import { offerWidgetPin } from '../../lib/widgetBridge';
import useAuthStore from '../../store/authStore';
import WeatherIcon from '../../components/WeatherIcon';
import HourlyStrip from './HourlyStrip';
import DailyList from './DailyList';
import DetailGrid from './DetailGrid';

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
  const [scrolled, setScrolled] = useState(false);

  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError('');
      try {
        const cities = await listCities();
        const found = cities.find((c) => c.id === id);
        if (!found) {
          navigate('/', { replace: true });
          return;
        }
        setCity(found);
        setLastOpenedCity(userId, found.id);

        try {
          const fresh = await getWeather(found.latitude, found.longitude);
          setData(fresh);
          setStale(null);
          cacheWeather(found.id, fresh);
          // First moment real, live weather has actually been shown — the
          // natural point to offer the home-screen widget, rather than
          // immediately on login before the user has seen the app do
          // anything. offerWidgetPin() itself only ever asks once.
          offerWidgetPin();
        } catch (err) {
          // Offline or upstream down — fall back to the last good payload so
          // the screen still shows something useful.
          const cached = readCachedWeather(found.id);
          if (cached) {
            setData(cached.data);
            setStale(cached.at);
          } else {
            setError(err.message);
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [id, navigate, userId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when the app comes back to the foreground — the common case on
  // phones, where the screen may have been backgrounded for hours.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const current = data?.current;
  const isDay = current?.is_day === 1;
  const code = current?.weather_code ?? 3;

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
      className="sky h-screen overflow-y-auto text-white"
    >
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
          <HourlyStrip
            hourly={data?.hourly}
            hourlyUnits={data?.hourly_units}
            timezone={data?.timezone}
            sunrise={data?.daily?.sunrise?.[todayIdx]}
            sunset={data?.daily?.sunset?.[todayIdx]}
          />

          <DailyList daily={data?.daily} timezone={data?.timezone} currentTemp={current?.temperature_2m} />

          <DetailGrid
            current={current}
            currentUnits={data?.current_units}
            daily={data?.daily}
            dailyUnits={data?.daily_units}
            air={data?.air_quality}
            moon={data?.moon}
            timezone={data?.timezone}
          />

          <p className="pt-2 text-center text-[11px] text-white/50">
            Open-Meteo · {data?.timezone}
          </p>
        </div>
      </div>
    </div>
  );
}
