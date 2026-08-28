import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getOverview, deleteCity, reorderCities } from '../../lib/api';
import { labelKey, iconFor, gradientCss } from '../../lib/weatherCodes';
import { round } from '../../lib/format';
import WeatherIcon from '../../components/WeatherIcon';

function CityCard({ city, onOpen, onRemove, onMove, isFirst, isLast, t, i18n }) {
  const code = city.current?.weather_code ?? city.today?.weather_code ?? 3;
  const isDay = city.current?.is_day === 1;

  const localTime = (() => {
    try {
      return new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: city.timezone,
      }).format(new Date());
    } catch {
      return '';
    }
  })();

  return (
    <li
      // The night gradient sits very close to the page background, so the card
      // needs an explicit edge or it dissolves into the page after dark.
      className="relative overflow-hidden rounded-3xl shadow-lg ring-1 ring-white/10"
      style={{ background: gradientCss(code, isDay, city.current?.temperature_2m) }}
    >
      <button onClick={onOpen} className="flex w-full items-start justify-between p-4 text-left text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-medium leading-tight">
            {city.is_current_location ? t('cities.myLocation') : city.name}
          </p>
          <p className="truncate text-xs text-white/75">
            {city.is_current_location ? city.name : localTime}
          </p>
          <p className="mt-6 truncate text-sm text-white/90">
            {city.error ? '—' : t(labelKey(code))}
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
        {/* My Location is always pinned first by the server regardless of
            sort_order, so manually reordering it doesn't do anything —
            hiding the arrows avoids offering a control that would appear to
            silently fail. */}
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
          </>
        )}
        <button
          onClick={onRemove}
          aria-label={t('app.delete')}
          className="rounded-full bg-black/25 px-2 text-xs text-white"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

export default function Cities() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setCities(await getOverview());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRemove(city) {
    const label = city.is_current_location ? t('cities.myLocation') : city.name;
    if (!window.confirm(t('cities.removeConfirm', { name: label }))) return;
    setCities((prev) => prev.filter((c) => c.id !== city.id));
    try {
      await deleteCity(city.id);
    } catch {
      load(); // put it back if the server disagreed
    }
  }

  async function handleMove(index, delta) {
    const next = [...cities];
    const target = index + delta;
    // A pinned My Location card (if present) always occupies index 0 server-
    // side, so no regular city may swap into that slot.
    const floor = next[0]?.is_current_location ? 1 : 0;
    if (target < floor || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setCities(next);
    try {
      await reorderCities(next.map((c) => c.id));
    } catch {
      load();
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="safe-top flex items-center justify-between py-4">
          <h1 className="text-3xl font-bold tracking-tight">{t('cities.title')}</h1>
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

        {loading && <p className="py-12 text-center text-white/60">{t('app.loading')}</p>}

        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-white/70">{error}</p>
            <button onClick={load} className="rounded-lg bg-white/10 px-4 py-2 text-sm">
              {t('app.retry')}
            </button>
          </div>
        )}

        {!loading && !error && cities.length === 0 && (
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
          {cities.map((city, i) => (
            <CityCard
              key={city.id}
              city={city}
              t={t}
              i18n={i18n}
              isFirst={i === 0 || (i === 1 && cities[0]?.is_current_location)}
              isLast={i === cities.length - 1}
              onOpen={() => navigate(`/city/${city.id}`)}
              onRemove={() => handleRemove(city)}
              onMove={(delta) => handleMove(i, delta)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
