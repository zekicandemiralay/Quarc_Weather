import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cityStore, here } from '../../lib/localData';
import { useLive } from '../../lib/useLive';
import { searchPlaces } from '../../lib/forecast/provider';
import { cityKey } from '../../lib/cityKey';

export default function AddCity() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const existing = useLive(() => cityStore.listCities(), [], []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search — the geocoder is fast, but typing "istanbul" shouldn't fire eight requests. The search goes
  // straight to the weather provider's geocoder, so it works whenever the device has internet, server or not.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        setResults(await searchPlaces(query, { language: i18n.language }));
        setError('');
      } catch (err) {
        setError(err.message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, i18n.language]);

  // Same cell = same city (the id is derived from the coordinates), so this matches exactly what saving would do.
  const alreadySaved = (r) => existing.some((c) => c.id === cityKey(r.latitude, r.longitude));

  async function handleAdd(place) {
    setBusy(true);
    setError('');
    try {
      await cityStore.addCity(place);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleUseLocation() {
    // here.refresh picks the right GPS path itself (native Capacitor plugin on Android, browser API everywhere
    // else). My Location is stored on this device only — it appears as the first card and is never synced.
    setBusy(true);
    setError('');
    const { fresh, record } = await here.refresh({ language: i18n.language, timeout: 10000 });
    if (!fresh && !record) {
      setBusy(false);
      // The specific cause (denied vs. unavailable vs. timed out) is swallowed on purpose — a generic message is
      // honest here since we genuinely can't tell which one happened.
      setError(t('cities.locationUnavailable'));
      return;
    }
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="safe-top flex items-center gap-3 py-4">
          <button onClick={() => navigate('/')} className="text-sm text-white/80">
            <span className="text-lg leading-none">‹</span> {t('app.cancel')}
          </button>
          <h1 className="text-lg font-semibold">{t('cities.addCity')}</h1>
        </header>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('cities.searchPlaceholder')}
          className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-base outline-none placeholder:text-white/40 focus:border-accent"
        />

        <button
          onClick={handleUseLocation}
          disabled={busy}
          className="mt-3 flex w-full items-center gap-2 rounded-xl bg-white/5 px-4 py-3 text-left text-sm text-white/90 disabled:opacity-50"
        >
          <span>📍</span> {t('cities.useMyLocation')}
        </button>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {searching && <p className="mt-4 text-sm text-white/50">{t('cities.searching')}</p>}

        {!searching && query.trim().length >= 2 && results.length === 0 && !error && (
          <p className="mt-6 text-center text-sm text-white/50">{t('cities.noResults')}</p>
        )}

        <ul className="mt-4 flex flex-col divide-y divide-white/10">
          {results.map((r) => {
            const saved = alreadySaved(r);
            return (
              <li key={`${r.latitude},${r.longitude}`}>
                <button
                  onClick={() => !saved && handleAdd(r)}
                  disabled={busy || saved}
                  className="flex w-full items-center justify-between py-3 text-left disabled:opacity-40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="truncate text-xs text-white/60">
                      {[r.admin1, r.country].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <span className="pl-3 text-xs text-white/50">
                    {saved ? t('cities.alreadyAdded') : '+'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
