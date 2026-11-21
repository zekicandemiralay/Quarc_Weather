import { useTranslation } from 'react-i18next';
import { ALERT_ICONS, formatAlertWindow } from '../../lib/alerts';
import { weekdayFor } from '../../lib/format';

/**
 * Heads-ups for the next 48 hours — derived from the forecast itself (the
 * weather data source has no official warnings), and labelled as such so
 * nobody mistakes it for a civil-protection alert. Renders nothing when
 * there's nothing worth flagging.
 */
export default function AlertsCard({ alerts, todayDate }) {
  const { t, i18n } = useTranslation();
  if (!alerts?.length || !todayDate) return null;

  const labels = {
    now: t('alerts.now'),
    tomorrow: t('alerts.tomorrow'),
    weekday: (iso) => weekdayFor(iso, i18n.language),
  };

  return (
    <section className="glass p-4" data-testid="alerts-card">
      <h2 className="card-label mb-2">⚠ {t('alerts.title')}</h2>
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => {
          const severe = a.level >= 2;
          return (
            <li
              key={`${a.type}-${a.start}`}
              data-level={a.level}
              className={`flex items-start gap-3 rounded-xl border-l-4 px-3 py-2 ${
                severe ? 'border-red-400 bg-red-500/20' : 'border-amber-300 bg-amber-400/15'
              }`}
            >
              <span className="text-2xl leading-none" aria-hidden="true">
                {ALERT_ICONS[a.type] || '⚠️'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-white">
                  {t(`alerts.types.${a.type}`)}
                  <span
                    className={`rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wide ${
                      severe ? 'bg-red-400 text-red-950' : 'bg-amber-300 text-amber-950'
                    }`}
                  >
                    {severe ? t('alerts.warning') : t('alerts.advisory')}
                  </span>
                </p>
                <p className="text-xs text-white/80">{formatAlertWindow(a, todayDate, labels)}</p>
                {a.value != null && (
                  <p className="text-xs text-white/70">
                    {t(`alerts.detail.${a.type}`, { value: a.value, unit: a.unit || '', defaultValue: '' })}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-white/50">{t('alerts.disclaimer')}</p>
    </section>
  );
}
