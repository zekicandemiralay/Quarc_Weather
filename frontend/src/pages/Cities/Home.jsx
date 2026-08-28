import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import { resolveLandingCityId } from '../../lib/landing';
import Cities from './Cities';

// Module-level, not component state — it must survive Home unmounting and
// remounting within the same page load (e.g. tapping the header's "‹
// Weather" back button), so returning to the list doesn't immediately bounce
// the user away again. It only resets on a genuine reload/relaunch, which is
// exactly when "opening the app" should re-run this.
let resolvedForUser;

/**
 * The "/" route. On first load per session it tries to land on current-
 * location weather, falling back to the last city viewed, before ever
 * showing the plain list — see lib/landing.js for the priority order.
 */
export default function Home() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const [ready, setReady] = useState(resolvedForUser === userId);

  useEffect(() => {
    if (!userId || resolvedForUser === userId) {
      setReady(true);
      return;
    }
    resolvedForUser = userId;

    let cancelled = false;
    resolveLandingCityId(userId).then((cityId) => {
      if (cancelled) return;
      if (cityId) {
        navigate(`/city/${cityId}`, { replace: true });
      } else {
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId, navigate]);

  if (!ready) {
    // Plain sky background while resolving — this is normally quick (a
    // denied/unavailable location check fails fast), and only takes longer
    // when the OS location permission prompt is waiting on the user.
    return (
      <div className="sky flex h-screen items-center justify-center">
        <img src="/logo.png" alt="" className="h-16 w-16 animate-pulse rounded-2xl opacity-90" />
      </div>
    );
  }

  return <Cities />;
}
