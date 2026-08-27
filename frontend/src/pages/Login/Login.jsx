import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';
import { apiUrl } from '../../lib/apiUrl';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        const res = await fetch(apiUrl('/api/auth/register'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Sign up failed');
        }
        await useAuthStore.getState().checkSession();
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sky flex h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl border border-white/20 bg-white/10 p-8 backdrop-blur-2xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/logo.png" alt="Quarc Weather" className="h-16 w-16 rounded-2xl" />
          <h1 className="text-lg font-semibold text-white">{t('auth.signInToAccount')}</h1>
          <p className="text-xs text-white/70">{t('auth.sharedNote')}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            className="rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-white outline-none placeholder:text-white/50 focus:border-white/60"
            placeholder={t('auth.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus
          />
          <input
            className="rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-white outline-none placeholder:text-white/50 focus:border-white/60"
            placeholder={t('auth.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 rounded-xl bg-white px-3 py-2.5 font-semibold text-slate-900 hover:bg-white/90 disabled:opacity-50"
          >
            {mode === 'login' ? t('auth.login') : t('auth.signup')}
          </button>
        </form>

        <button
          className="mt-4 w-full text-center text-sm text-white/70 hover:underline"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login' ? t('auth.needAccount') : t('auth.haveAccount')}
        </button>
      </div>
    </div>
  );
}
