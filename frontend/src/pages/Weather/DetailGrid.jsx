import { useTranslation } from 'react-i18next';
import { round, timeIn, windDirection, aqiBand, uvBand } from '../../lib/format';

function Tile({ label, children, wide = false }) {
  return (
    <div className={`glass flex flex-col gap-2 p-4 ${wide ? 'col-span-2' : ''}`}>
      <h3 className="card-label">{label}</h3>
      <div className="flex flex-1 flex-col justify-between gap-2">{children}</div>
    </div>
  );
}

const Big = ({ children }) => <p className="text-3xl font-semibold leading-none text-white">{children}</p>;
const Note = ({ children }) => <p className="text-xs leading-snug text-white/70">{children}</p>;

/** Horizontal meter used by UV and AQI. */
function Meter({ pct, color }) {
  return (
    <div className="relative h-1.5 w-full rounded-full bg-gradient-to-r from-green-400 via-yellow-400 to-fuchsia-600">
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-white"
        style={{ left: `${Math.min(100, Math.max(0, pct * 100))}%`, borderColor: color }}
      />
    </div>
  );
}

/** Moon disc drawn from the illuminated fraction. */
function MoonDisc({ fraction, size = 44 }) {
  const waxing = fraction < 0.5;
  const illum = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  // Terminator is an ellipse whose x-radius tracks how far from half-phase we are.
  const rx = Math.abs(0.5 - illum) * 2 * (size / 2);
  const lit = illum > 0.5;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="#1e293b" />
      <defs>
        <clipPath id="moon-clip">
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} />
        </clipPath>
      </defs>
      <g clipPath="url(#moon-clip)">
        {illum > 0.02 && (
          <>
            <rect
              x={waxing ? size / 2 : 0}
              y={0}
              width={size / 2}
              height={size}
              fill="#e2e8f0"
            />
            <ellipse
              cx={size / 2}
              cy={size / 2}
              rx={rx}
              ry={size / 2 - 1}
              fill={lit ? '#e2e8f0' : '#1e293b'}
            />
          </>
        )}
      </g>
    </svg>
  );
}

export default function DetailGrid({ current, currentUnits, daily, dailyUnits, air, moon, timezone }) {
  const { t, i18n } = useTranslation();
  const d = 1; // today's index (past_days=1 shifts everything by one)

  const uv = daily?.uv_index_max?.[d];
  const uvInfo = uvBand(uv);
  const aqiValue = air?.current?.european_aqi;
  const aqi = aqiBand(aqiValue);

  // `current.visibility` is metres, straight from the current block — never
  // read hourly[0] here: with past_days=1 that index is 24 hours ago.
  const visibility = current?.visibility;
  const daylightH = daily?.daylight_duration?.[d] ? daily.daylight_duration[d] / 3600 : null;

  return (
    <section className="grid grid-cols-2 gap-3">
      <Tile label={`☀ ${t('details.uvIndex')}`}>
        <div>
          <Big>{uv === null || uv === undefined ? '--' : Math.round(uv)}</Big>
          <p className="text-sm font-medium text-white/90">{t(`uv.${uvInfo.key}`)}</p>
        </div>
        <Meter pct={(uv ?? 0) / 12} color={uvInfo.color} />
      </Tile>

      <Tile label={`💨 ${t('details.wind')}`}>
        <div>
          <Big>
            {round(current?.wind_speed_10m)}
            <span className="ml-1 text-base font-normal text-white/70">{currentUnits?.wind_speed_10m}</span>
          </Big>
          <p className="text-sm text-white/90">
            {windDirection(current?.wind_direction_10m)} · {t('details.gusts')} {round(current?.wind_gusts_10m)}
          </p>
        </div>
      </Tile>

      <Tile label={`🌅 ${t('details.sunrise')}`}>
        <Big>{daily?.sunrise?.[d] ? timeIn(daily.sunrise[d], timezone, i18n.language) : '--:--'}</Big>
        <Note>
          {t('details.sunset')}: {daily?.sunset?.[d] ? timeIn(daily.sunset[d], timezone, i18n.language) : '--:--'}
        </Note>
      </Tile>

      <Tile label={`🌡 ${t('details.feelsLike')}`}>
        <Big>
          {round(current?.apparent_temperature)}
          {currentUnits?.apparent_temperature || '°'}
        </Big>
        <Note>
          {t('details.humidity')}: {round(current?.relative_humidity_2m)}%
        </Note>
      </Tile>

      <Tile label={`💧 ${t('details.rainfall')}`}>
        <Big>
          {round(daily?.precipitation_sum?.[d])}
          <span className="ml-1 text-base font-normal text-white/70">{dailyUnits?.precipitation_sum}</span>
        </Big>
        <Note>
          {t('details.rainChance')}: {round(daily?.precipitation_probability_max?.[d])}%
        </Note>
      </Tile>

      <Tile label={`👁 ${t('details.visibility')}`}>
        <Big>
          {visibility === null || visibility === undefined ? '--' : Math.round(visibility / 1000)}
          <span className="ml-1 text-base font-normal text-white/70">km</span>
        </Big>
        <Note>
          {t('details.cloudCover')}: {round(current?.cloud_cover)}%
        </Note>
      </Tile>

      <Tile label={`🧭 ${t('details.pressure')}`}>
        <Big>
          {round(current?.pressure_msl)}
          <span className="ml-1 text-base font-normal text-white/70">hPa</span>
        </Big>
        <Note>
          {t('details.daylight')}: {daylightH ? `${Math.floor(daylightH)}h ${Math.round((daylightH % 1) * 60)}m` : '--'}
        </Note>
      </Tile>

      <Tile label={`🌙 ${t('details.moonPhase')}`}>
        <div className="flex items-center gap-3">
          <MoonDisc fraction={moon?.fraction ?? 0} />
          <div>
            <p className="text-sm font-semibold leading-tight text-white">{t(`moon.${moon?.phase || 'new'}`)}</p>
            <Note>{t('moon.illumination', { percent: Math.round((moon?.illumination ?? 0) * 100) })}</Note>
          </div>
        </div>
      </Tile>

      {aqiValue !== null && aqiValue !== undefined && (
        <Tile label={`🌫 ${t('details.airQuality')}`} wide>
          <div className="flex items-end justify-between gap-4">
            <div>
              <Big>{Math.round(aqiValue)}</Big>
              <p className="text-sm font-medium text-white/90">
                {t(`aqi.${aqi.key}`)} · {t('aqi.europeanScale')}
              </p>
            </div>
            <div className="text-right text-xs leading-relaxed text-white/70">
              <div>PM2.5 {round(air.current.pm2_5)} µg/m³</div>
              <div>PM10 {round(air.current.pm10)} µg/m³</div>
              <div>O₃ {round(air.current.ozone)} µg/m³</div>
            </div>
          </div>
          <Meter pct={aqi.pct} color={aqi.color} />
        </Tile>
      )}
    </section>
  );
}
