import { useTranslation } from 'react-i18next';
import WeatherIcon from '../../components/WeatherIcon';
import { iconFor } from '../../lib/weatherCodes';
import { round, weekdayIn, ratio } from '../../lib/format';

/**
 * 10-day list. Each row's temperature bar is positioned against the *range of
 * the whole period*, not its own min/max — that's what makes a cold Thursday
 * visibly sit to the left of a warm Saturday.
 */
export default function DailyList({ daily, timezone, currentTemp }) {
  const { t, i18n } = useTranslation();
  if (!daily?.time?.length) return null;

  // past_days=1 means index 0 is yesterday; today starts at 1.
  const startIdx = 1;
  const days = daily.time.slice(startIdx);

  const lows = daily.temperature_2m_min.slice(startIdx).filter((n) => n !== null);
  const highs = daily.temperature_2m_max.slice(startIdx).filter((n) => n !== null);
  const globalMin = Math.min(...lows);
  const globalMax = Math.max(...highs);

  return (
    <section className="glass p-4">
      <h2 className="card-label mb-2">{t('weather.dailyForecast')}</h2>
      <ul className="divide-y divide-white/10">
        {days.map((iso, i) => {
          const idx = startIdx + i;
          const min = daily.temperature_2m_min[idx];
          const max = daily.temperature_2m_max[idx];
          const pop = daily.precipitation_probability_max?.[idx];

          const left = ratio(min, globalMin, globalMax);
          const right = ratio(max, globalMin, globalMax);
          const width = Math.max(0.06, right - left);

          // Where "now" sits inside today's range, shown as a dot on row one.
          const nowDot = i === 0 && currentTemp !== null && currentTemp !== undefined
            ? ratio(currentTemp, globalMin, globalMax)
            : null;

          return (
            <li key={iso} className="flex items-center gap-3 py-2.5">
              <span className="w-11 shrink-0 text-sm font-medium text-white">
                {i === 0 ? t('weather.today') : weekdayIn(iso, timezone, i18n.language)}
              </span>

              <div className="flex w-11 shrink-0 items-center gap-1">
                <WeatherIcon icon={iconFor(daily.weather_code[idx], true)} size={26} />
              </div>

              <span className="w-8 shrink-0 text-[11px] font-medium text-sky-200">
                {pop > 15 ? `${pop}%` : ''}
              </span>

              <span className="w-8 shrink-0 text-right text-sm text-white/60">{round(min)}</span>

              <div className="relative h-1.5 flex-1 rounded-full bg-white/15">
                <div
                  className="absolute h-1.5 rounded-full bg-gradient-to-r from-sky-300 via-amber-200 to-orange-400"
                  style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                />
                {nowDot !== null && (
                  <span
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-800 bg-white"
                    style={{ left: `${nowDot * 100}%` }}
                  />
                )}
              </div>

              <span className="w-8 shrink-0 text-sm font-semibold text-white">{round(max)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
