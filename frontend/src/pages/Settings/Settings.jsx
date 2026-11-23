import StorePromo from '../../components/StorePromo';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';
import usePrefsStore from '../../store/prefsStore';
import { getPlatform, getCurrentVersion, checkForUpdate, installUpdate } from '../../lib/updateCheck';
import { getWidgetCount, openWidgetSettings, requestWidgetPin } from '../../lib/widgetBridge';
import { sync, useSyncStore } from '../../lib/localData';
import SyncBadge from '../../components/SyncBadge';

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">{title}</h2>
      <div className="overflow-hidden rounded-2xl bg-white/5">{children}</div>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 px-4 py-3 last:border-0">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex rounded-lg bg-white/10 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value ? 'bg-white text-slate-900' : 'text-white/70'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How this device stands with the account's server. The list and the settings live on the device and sync in the
 * background; this says when that last happened and lets you ask for it now. With Tailscale off the server is
 * "unreachable" — a calm, expected state: everything keeps working and the changes wait.
 */
function SyncSection({ t }) {
  const status = useSyncStore((s) => s.status);
  const lastSync = useSyncStore((s) => s.lastSync);
  const pending = useSyncStore((s) => s.pending);

  return (
    <Section title={t('sync.title')}>
      <div className="px-4 py-3" data-testid="sync-section">
        <p className="mb-3 text-xs text-white/60">{t('sync.hint')}</p>
        <p className="mb-3 text-sm text-white/80">
          {lastSync ? t('sync.lastSync', { time: new Date(lastSync).toLocaleString() }) : t('sync.never')}
          {pending > 0 ? ` · ${t('sync.pending', { count: pending })}` : ''}
        </p>
        <SyncBadge className="mb-3" />
        <button
          onClick={() => sync.syncNow()}
          disabled={status === 'syncing'}
          className="w-full rounded-lg bg-white/10 py-2 text-sm font-medium disabled:opacity-50"
          data-testid="sync-now"
        >
          {status === 'syncing' ? t('sync.syncing') : t('sync.syncNow')}
        </button>
      </div>
    </Section>
  );
}

/**
 * Android only: the home-screen widget's look (layout, background incl. transparent, text,
 * city) is chosen on a native screen, since the widget itself is native. This is the door to
 * it for a widget that's already placed — and a way to add one if there isn't one yet.
 */
function WidgetSection({ t }) {
  const [count, setCount] = useState(null); // null = still asking
  const [pinNote, setPinNote] = useState('');

  useEffect(() => {
    let alive = true;
    const refresh = () => getWidgetCount().then((n) => alive && setCount(n));
    refresh();
    // Coming back from the launcher's "add widget" prompt (or from the native settings
    // screen) should show the new state without leaving this page.
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function add() {
    setPinNote('');
    const accepted = await requestWidgetPin();
    // Not accepted: this launcher won't add widgets for an app — say how to do it by hand.
    if (!accepted) setPinNote(t('settings.widgetAddManual'));
  }

  return (
    <Section title={t('settings.widget')}>
      <div className="px-4 py-3">
        <p className="mb-3 text-xs text-white/60">{t('settings.widgetHint')}</p>

        {count === 0 && <p className="mb-3 text-xs text-white/60">{t('settings.widgetNone')}</p>}

        {count > 0 && (
          <button
            onClick={() => openWidgetSettings()}
            className="mb-2 w-full rounded-lg bg-accent py-2 text-sm font-semibold"
            data-testid="widget-customize"
          >
            {t('settings.widgetCustomize')}
          </button>
        )}

        <button
          onClick={add}
          className="w-full rounded-lg bg-white/10 py-2 text-sm font-medium"
          data-testid="widget-add"
        >
          {count > 0 ? t('settings.widgetAddAnother') : t('settings.widgetAdd')}
        </button>

        {pinNote && <p className="mt-2 text-xs text-amber-300">{pinNote}</p>}
      </div>
    </Section>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const prefs = usePrefsStore((s) => s.prefs);
  const update = usePrefsStore((s) => s.update);

  const platform = getPlatform();
  const [version, setVersion] = useState(null);
  const [updateState, setUpdateState] = useState({ status: 'idle', info: null, error: '' });

  useEffect(() => {
    getCurrentVersion(platform).then(setVersion);
  }, [platform]);

  async function handleCheck() {
    setUpdateState({ status: 'checking', info: null, error: '' });
    try {
      const info = await checkForUpdate();
      setUpdateState({ status: info ? 'available' : 'current', info, error: '' });
    } catch (err) {
      setUpdateState({ status: 'error', info: null, error: err.message });
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <header className="safe-top flex items-center gap-3 py-4">
          <button onClick={() => navigate('/')} className="text-sm text-white/80">
            <span className="text-lg leading-none">‹</span> {t('cities.title')}
          </button>
          <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
        </header>

        <Section title={t('settings.units')}>
          <Row label={t('settings.temperature')}>
            <Segmented
              value={prefs.units}
              onChange={(v) => update({ units: v })}
              options={[
                { value: 'metric', label: '°C' },
                { value: 'imperial', label: '°F' },
              ]}
            />
          </Row>
          <Row label={t('settings.windSpeed')}>
            <Segmented
              value={prefs.wind_unit}
              onChange={(v) => update({ wind_unit: v })}
              options={[
                { value: 'kmh', label: 'km/h' },
                { value: 'ms', label: 'm/s' },
                { value: 'mph', label: 'mph' },
                { value: 'kn', label: 'kn' },
              ]}
            />
          </Row>
          <Row label={t('settings.precipitation')}>
            <Segmented
              value={prefs.precip_unit}
              onChange={(v) => update({ precip_unit: v })}
              options={[
                { value: 'mm', label: 'mm' },
                { value: 'inch', label: 'in' },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented
              value={prefs.theme}
              onChange={(v) => update({ theme: v })}
              options={[
                { value: 'auto', label: t('settings.themeAuto') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'dark', label: t('settings.themeDark') },
              ]}
            />
          </Row>
          <Row label={t('settings.language')}>
            <Segmented
              value={prefs.language}
              onChange={(v) => update({ language: v })}
              options={[
                { value: 'en', label: 'English' },
                { value: 'tr', label: 'Türkçe' },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.dailyBriefing')}>
          <Row label={t('settings.dailyBriefingEnable')}>
            <Segmented
              value={prefs.daily_briefing_enabled ? 'on' : 'off'}
              onChange={(v) => update({ daily_briefing_enabled: v === 'on' })}
              options={[
                { value: 'off', label: t('settings.off') },
                { value: 'on', label: t('settings.on') },
              ]}
            />
          </Row>
          <Row label={t('settings.dailyBriefingTime')}>
            <input
              type="time"
              value={`${String(prefs.daily_briefing_hour ?? 8).padStart(2, '0')}:${String(
                prefs.daily_briefing_minute ?? 0
              ).padStart(2, '0')}`}
              disabled={!prefs.daily_briefing_enabled}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (Number.isFinite(h) && Number.isFinite(m)) {
                  update({ daily_briefing_hour: h, daily_briefing_minute: m });
                }
              }}
              className="rounded-lg bg-white/10 px-2 py-1 text-sm text-white [color-scheme:dark] disabled:opacity-40"
            />
          </Row>
          {platform !== 'android' && (
            <p className="px-4 pb-3 text-xs text-white/50">{t('settings.dailyBriefingAndroidOnly')}</p>
          )}
        </Section>

        {platform === 'android' && <WidgetSection t={t} />}

        <SyncSection t={t} />

        <Section title={t('settings.about')}>
          <Row label={t('settings.version')}>
            <span className="text-sm text-white/60">{version || '—'}</span>
          </Row>

          {platform !== 'web' && (
            <div className="border-b border-white/5 px-4 py-3 last:border-0">
              <button
                onClick={handleCheck}
                disabled={updateState.status === 'checking'}
                className="w-full rounded-lg bg-white/10 py-2 text-sm font-medium disabled:opacity-50"
              >
                {updateState.status === 'checking' ? t('settings.checking') : t('settings.checkForUpdates')}
              </button>

              {updateState.status === 'current' && (
                <p className="mt-2 text-center text-xs text-white/60">{t('settings.upToDate')}</p>
              )}
              {updateState.status === 'error' && (
                <p className="mt-2 text-center text-xs text-red-400">{t('settings.updateFailed')}</p>
              )}
              {updateState.status === 'available' && updateState.info && (
                <div className="mt-3 rounded-xl bg-accent/20 p-3">
                  <p className="text-sm font-medium">
                    {t('settings.updateAvailable', { version: updateState.info.latest })}
                  </p>
                  <button
                    onClick={() => installUpdate(platform, updateState.info.url, updateState.info.latest)}
                    className="mt-2 w-full rounded-lg bg-accent py-2 text-sm font-semibold"
                  >
                    {t('settings.install')}
                  </button>
                </div>
              )}
              <StorePromo />
            </div>
          )}

          {platform === 'web' && (
            <div className="px-4 py-3">
              <a
                href="https://github.com/zekicandemiralay/Quarc_Weather/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-lg bg-white/10 py-2 text-center text-sm font-medium"
              >
                {t('settings.downloadPage')}
              </a>
            </div>
          )}
        </Section>

        <Section title={t('settings.account')}>
          <Row label={t('settings.signedInAs', { username: user?.username || '' })}>
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="rounded-lg bg-red-500/20 px-3 py-1 text-xs font-medium text-red-300"
            >
              {t('auth.logout')}
            </button>
          </Row>
        </Section>
      </div>
    </div>
  );
}
