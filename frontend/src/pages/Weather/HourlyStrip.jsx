import { useTranslation } from 'react-i18next';
import WeatherIcon from '../../components/WeatherIcon';
import { iconFor } from '../../lib/weatherCodes';
import { round, hourIn } from '../../lib/format';

/**
 * The next 24 hours, starting from the current hour. Open-Meteo returns the
 * whole day (plus yesterday, via past_days=1), so the slice has to be found
 * by timestamp rather than assumed to start at index 0.
 */
export default function HourlyStrip({ hourly, hourlyUnits, timezone, sunrise, sunset }) {
  const { t, i18n } = useTranslation();
  if (!hourly?.time?.length) return null;

  const now = Date.now();
  const start = Math.max(
    0,
    hourly.time.findIndex((iso) => new Date(iso).getTime() >= now - 3600_000)
  );
  const slice = hourly.time.slice(start, start + 24);

  // Sunrise/sunset get inserted into the strip as their own cells, the way
  // Apple's does — it's the clearest way to show where the day turns over.
  const events = [];
  if (sunrise) events.push({ iso: sunrise, kind: 'sunrise' });
  if (sunset) events.push({ iso: sunset, kind: 'sunset' });

  const cells = slice.map((iso, i) => ({
    kind: 'hour',
    iso,
    index: start + i,
  }));

  for (const ev of events) {
    const ts = new Date(ev.iso).getTime();
    if (ts < new Date(slice[0]).getTime() || ts > new Date(slice[slice.length - 1]).getTime()) continue;
    const at = cells.findIndex((c) => c.kind === 'hour' && new Date(c.iso).getTime() > ts);
    if (at >= 0) cells.splice(at, 0, ev);
  }

  return (
    <section className="glass p-4">
      <h2 className="card-label mb-3">{t('weather.hourlyForecast')}</h2>
      <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        {cells.map((cell, i) => {
          if (cell.kind !== 'hour') {
            return (
              <div key={`ev-${i}`} className="flex min-w-[68px] flex-col items-center gap-2 px-2 py-1">
                <span className="text-xs font-medium text-white/70">
                  {new Intl.DateTimeFormat(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: timezone,
                  }).format(new Date(cell.iso))}
                </span>
                <span className="text-2xl leading-none">{cell.kind === 'sunrise' ? '🌅' : '🌇'}</span>
                <span className="text-xs font-semibold text-white/90">
                  {cell.kind === 'sunrise' ? t('details.sunrise') : t('details.sunset')}
                </span>
              </div>
            );
          }

          const idx = cell.index;
          const isNow = i === 0 || (cells[0].kind !== 'hour' && i === 1);
          const pop = hourly.precipitation_probability?.[idx];

          return (
            <div
              key={cell.iso}
              className={`flex min-w-[68px] flex-col items-center gap-2 rounded-xl px-2 py-2 ${
                isNow ? 'bg-white/15' : ''
              }`}
            >
              <span className="text-xs font-medium text-white/70">
                {isNow ? t('weather.now') : hourIn(cell.iso, timezone, i18n.language)}
              </span>
              <WeatherIcon icon={iconFor(hourly.weather_code?.[idx], hourly.is_day?.[idx] === 1)} size={30} />
              {pop > 15 ? (
                <span className="text-[11px] font-medium text-sky-200">{pop}%</span>
              ) : (
                <span className="text-[11px] text-transparent">·</span>
              )}
              {/* Degree symbol only — the unit is obvious from context and
                  repeating "°C" 24 times across the strip just adds noise. */}
              <span className="text-base font-semibold text-white">
                {round(hourly.temperature_2m?.[idx])}°
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
