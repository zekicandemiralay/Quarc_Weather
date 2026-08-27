import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { searchCities, addCity, listCities } from '../../lib/api';

export default function AddCity() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [existing, setExisting] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    listCities().then(setExisting).catch(() => {});
  }, []);

  // Debounced search — the geocoder is fast, but typing "istanbul" shouldn't
  // fire eight requests.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        setResults(await searchCities(query, i18n.language));
        setError('');
      } catch (err) {
        setError(err.message);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, i18n.language]);

  const alreadySaved = (r) =>
    existing.some(
      (c) => Math.abs(c.latitude - r.latitude) < 0.02 && Math.abs(c.longitude - r.longitude) < 0.02
    );

  async function handleAdd(place, isCurrentLocation = false) {
    setBusy(true);
    setError('');
    try {
      await addCity({
        name: place.name,
        country: place.country,
        country_code: place.country_code,
        admin1: place.admin1,
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone,
        is_current_location: isCurrentLocation,
      });
      navigate('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function handleUseLocation() {
    if (!navigator.geolocation) {
      setError(t('cities.locationUnavailable'));
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // Open-Meteo has no reverse-geocoding endpoint, so there's no honest way
        // to name the point — searching the geocoder for a latitude string just
        // returns unrelated places. Store the coordinates and let the card show
        // "My Location"; the timezone comes back with the forecast anyway.
        handleAdd(
          {
            name: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
            latitude,
            longitude,
          },
          true
        );
      },
      (err) => {
        setBusy(false);
        setError(err.code === err.PERMISSION_DENIED ? t('cities.locationDenied') : t('cities.locationUnavailable'));
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
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
