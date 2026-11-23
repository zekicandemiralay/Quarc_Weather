import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cityStore, here, forecasts, useSyncStore } from '../../lib/localData';
import { useLive } from '../../lib/useLive';
import { labelKey, iconFor, gradientCss } from '../../lib/weatherCodes';
import { round, nowInTimezone } from '../../lib/format';
import WeatherIcon from '../../components/WeatherIcon';
import SyncBadge from '../../components/SyncBadge';

/**
 * Each card's forecast, loaded city by city: whatever is cached paints immediately, the fresh answer replaces it as
 * it arrives, and one city failing leaves the others untouched.
 */
function useCityForecasts(cityList) {
  const [map, setMap] = useState({});
  const key = cityList.map((c) => `${c.id}:${c.latitude}:${c.longitude}`).join('|');

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all(
        cityList.map(async (c) => {
          const cached = await forecasts.peek(c).catch(() => null);
          if (alive && cached) setMap((m) => (m[c.id]?.data ? m : { ...m, [c.id]: { data: cached.data } }));
          try {
            const r = await forecasts.get(c);
            if (alive) setMap((m) => ({ ...m, [c.id]: { data: r.data, stale: r.stale } }));
          } catch (err) {
            if (alive) setMap((m) => ({ ...m, [c.id]: { ...(m[c.id] || {}), error: err.message } }));
          }
        })
      );
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

function CityCard({ city, onOpen, onRemove, onMove, isFirst, isLast, t, i18n }) {
  const code = city.current?.weather_code ?? city.today?.weather_code ?? 3;
  const isDay = city.current?.is_day === 1;

  const localTime = nowInTimezone(city.timezone, i18n.language);

  return (
    <li
      // The night gradient sits very close to the page background, so the card
      // needs an explicit edge or it dissolves into the page after dark.
      className="relative overflow-hidden rounded-3xl shadow-lg ring-1 ring-white/10"
      style={{ background: gradientCss(code, isDay, city.current?.temperature_2m) }}
    >
      <button onClick={onOpen} className="flex w-full items-start justify-between p-4 text-left text-white">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-xl font-medium leading-tight">
            {/* A small live-location marker instead of replacing the real place name — "Cankurtaran" is more
                useful than a generic "My Location" label once we actually know where that is. */}
            {!!city.is_current_location && (
              <span aria-label={t('cities.myLocation')} title={t('cities.myLocation')} className="text-sm">
                📍
              </span>
            )}
            <span className="truncate">{city.name}</span>
          </p>
          <p className="truncate text-xs text-white/75">{localTime}</p>
          <p className="mt-6 truncate text-sm text-white/90">
            {city.error && !city.current ? '—' : city.current ? t(labelKey(code)) : ''}
          </p>
        </div>

        <div className="flex flex-col items-end pl-3">
          <div className="flex items-start">
            <span className="text-5xl font-thin leading-none tracking-tighter">
              {round(city.current?.temperature_2m)}
            </span>
            <span className="mt-1 text-xl font-thin text-white/80">°</span>
          </div>
          <WeatherIcon icon={iconFor(code, isDay)} size={30} className="mt-1" />
          <p className="mt-1 text-xs font-medium text-white/85">
            {t('weather.high')}:{round(city.today?.temperature_2m_max)}° {t('weather.low')}:
            {round(city.today?.temperature_2m_min)}°
          </p>
        </div>
      </button>

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100 md:opacity-60">
        {/* My Location belongs to this device and is always first, so there is nothing to reorder or remove. */}
        {!city.is_current_location && (
          <>
            <button
              onClick={() => onMove(-1)}
              disabled={isFirst}
              aria-label="Move up"
              className="rounded-full bg-black/25 px-2 text-xs text-white disabled:opacity-30"
            >
              ↑
            </button>
            <button
              onClick={() => onMove(1)}
              disabled={isLast}
              aria-label="Move down"
              className="rounded-full bg-black/25 px-2 text-xs text-white disabled:opacity-30"
            >
              ↓
            </button>
            <button
              onClick={onRemove}
              aria-label={t('app.delete')}
              className="rounded-full bg-black/25 px-2 text-xs text-white"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function Cities() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lastSync = useSyncStore((s) => s.lastSync);
  const status = useSyncStore((s) => s.status);

  const rows = useLive(() => cityStore.listCities(), [], null); // null = still reading the local database
  const hereRecord = useLive(() => here.get(), [], null);
  const hereCity = useMemo(() => here.asCity(hereRecord), [hereRecord]);

  const all = useMemo(() => (hereCity ? [hereCity, ...(rows || [])] : rows || []), [hereCity, rows]);
  const forecastMap = useCityForecasts(all);

  /** A city row merged with its forecast, in the shape the card reads. */
  const view = (c) => {
    const f = forecastMap[c.id];
    const d = f?.data;
    return {
      ...c,
      current: d?.current,
      today: d?.daily
        ? {
            weather_code: d.daily.weather_code?.[1],
            temperature_2m_max: d.daily.temperature_2m_max?.[1],
            temperature_2m_min: d.daily.temperature_2m_min?.[1],
          }
        : null,
      timezone: d?.timezone || c.timezone,
      error: f?.error || null,
    };
  };

  function handleRemove(city) {
    if (!window.confirm(t('cities.removeConfirm', { name: city.name }))) return;
    cityStore.removeCity(city.id);
  }

  const manual = rows || [];
  // The very first run on a new device with no connection to the server: nothing to show yet, and no way to
  // fetch it — say so plainly instead of an empty "add your first city".
  const waitingForFirstSync = rows !== null && manual.length === 0 && !hereCity && !lastSync && status === 'unreachable';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="safe-top flex items-center justify-between py-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('cities.title')}</h1>
            <SyncBadge className="mt-1" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/settings')} aria-label={t('settings.title')} className="text-xl">
              ⚙
            </button>
            <button
              onClick={() => navigate('/add')}
              aria-label={t('cities.addCity')}
              className="rounded-full bg-white/10 px-3 py-1 text-xl leading-none"
            >
              +
            </button>
          </div>
        </header>

        {rows === null && <p className="py-12 text-center text-white/60">{t('app.loading')}</p>}

        {waitingForFirstSync && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-lg font-medium">{t('sync.firstConnectTitle')}</p>
            <p className="text-sm text-white/60">{t('sync.firstConnectHint')}</p>
          </div>
        )}

        {rows !== null && !waitingForFirstSync && all.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <p className="text-lg font-medium">{t('cities.empty')}</p>
            <p className="text-sm text-white/60">{t('cities.emptyHint')}</p>
            <button
              onClick={() => navigate('/add')}
              className="mt-2 rounded-full bg-accent px-5 py-2 text-sm font-medium"
            >
              {t('cities.addCity')}
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {hereCity && (
            <CityCard
              key={hereCity.id}
              city={view(hereCity)}
              t={t}
              i18n={i18n}
              onOpen={() => navigate(`/city/${hereCity.id}`)}
            />
          )}
          {manual.map((city, i) => (
            <CityCard
              key={city.id}
              city={view(city)}
              t={t}
              i18n={i18n}
              isFirst={i === 0}
              isLast={i === manual.length - 1}
              onOpen={() => navigate(`/city/${city.id}`)}
              onRemove={() => handleRemove(city)}
              onMove={(delta) => cityStore.moveCity(city.id, delta)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
