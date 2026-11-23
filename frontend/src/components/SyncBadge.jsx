import { useTranslation } from 'react-i18next';
import { useSyncStore } from '../lib/localData';

/**
 * A small pill that says where the list stands with the server — and says nothing at all when everything is in
 * sync. "Unreachable" is the normal, expected state with Tailscale off, so it is worded calmly: the app is fully
 * usable, the changes are just waiting for the server.
 */
export default function SyncBadge({ className = '' }) {
  const { t } = useTranslation();
  const { status, pending } = useSyncStore();

  let text = null;
  let tone = 'bg-white/10 text-white/70';

  if (status === 'unreachable') {
    text = pending > 0 ? t('sync.unreachablePending', { count: pending }) : t('sync.unreachable');
  } else if (status === 'auth') {
    text = t('sync.signIn');
    tone = 'bg-amber-400/20 text-amber-200';
  } else if (status === 'error') {
    text = t('sync.error');
    tone = 'bg-red-500/20 text-red-200';
  } else if (pending > 0) {
    text = t('sync.pending', { count: pending });
  }

  if (!text) return null;
  return (
    <span data-testid="sync-badge" data-status={status} className={`inline-block rounded-full px-3 py-1 text-xs ${tone} ${className}`}>
      {text}
    </span>
  );
}
