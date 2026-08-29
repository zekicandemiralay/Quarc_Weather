import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import usePrefsStore from './store/prefsStore';
import useUpdateStore from './store/updateStore';
import UpdateBanner from './components/UpdateBanner';
import Login from './pages/Login/Login';
import Home from './pages/Cities/Home';
import AddCity from './pages/Cities/AddCity';
import WeatherView from './pages/Weather/WeatherView';
import Settings from './pages/Settings/Settings';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore();
  const ensureChecked = useUpdateStore((s) => s.ensureChecked);
  const update = useUpdateStore((s) => (s.dismissed ? null : s.update));
  const dismiss = useUpdateStore((s) => s.dismiss);

  useEffect(() => {
    if (user) ensureChecked();
  }, [user, ensureChecked]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-slate-900 text-white/70">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <>
      <UpdateBanner update={update} onDismiss={dismiss} />
      {children}
    </>
  );
}

export default function App() {
  const checkSession = useAuthStore((s) => s.checkSession);
  const user = useAuthStore((s) => s.user);
  const loadPrefs = usePrefsStore((s) => s.load);
  const theme = usePrefsStore((s) => s.prefs.theme);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (user) loadPrefs();
  }, [user, loadPrefs]);

  // The weather screens are always dark-on-gradient; the theme preference only
  // drives the neutral surfaces (city list, settings, login).
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && media.matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/add"
        element={
          <ProtectedRoute>
            <AddCity />
          </ProtectedRoute>
        }
      />
      <Route
        path="/city/:id"
        element={
          <ProtectedRoute>
            <WeatherView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
