import { useTranslation } from 'react-i18next';
import { installUpdate } from '../lib/updateCheck';

/**
 * The startup "a new version is available" strip — shown automatically,
 * without the user needing to go into Settings, matching Quarc Music's
 * banner. Normal document flow (not fixed/overlay), so it pushes page
 * content down rather than covering it.
 */
export default function UpdateBanner({ update, onDismiss }) {
  const { t } = useTranslation();
  if (!update) return null;

  function handleInstall() {
    installUpdate(update.platform, update.url, update.latest);
    onDismiss();
  }

  return (
    <div className="safe-top flex items-center justify-center gap-2 bg-emerald-700 px-4 py-1.5 text-center text-xs font-medium text-white">
      <span aria-hidden="true">🔄</span>
      <span>{t('settings.updateAvailable', { version: update.latest })}</span>
      <button onClick={handleInstall} className="underline underline-offset-2 hover:text-emerald-200">
        {t('settings.install')}
      </button>
      <button onClick={onDismiss} aria-label={t('app.close')} className="hover:text-emerald-200">
        ✕
      </button>
    </div>
  );
}
