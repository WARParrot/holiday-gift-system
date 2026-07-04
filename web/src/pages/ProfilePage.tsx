import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { Avatar } from '../components/Avatar';

/** Profile management — edit full name, birthdate, and avatar URL. */
export function ProfilePage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const token = useAuth((s) => s.token);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [birthdate, setBirthdate] = useState(user?.birthdate ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendarBanner, setCalendarBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // The calendar OAuth callback redirects the browser back to
  // /profile?calendar=<provider>&status=connected|error&detail=<info>.
  // Surface that outcome once, then strip the query so a refresh won't repeat it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cal = params.get('calendar');
    const st = params.get('status');
    if (!cal || !st) return;
    const detail = params.get('detail');
    setCalendarBanner(
      st === 'connected'
        ? { ok: true, text: t('profile.calendarConnected', { provider: cal, detail: detail ? ` (${detail})` : '' }) }
        : { ok: false, text: t('profile.calendarError', { provider: cal, detail: detail || 'unknown error' }) },
    );
    window.history.replaceState({}, '', window.location.pathname);
  }, [t]);

  if (!user) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setError(null);
    try {
      const res = await api.updateMe({ fullName: fullName.trim(), birthdate, avatarUrl: avatarUrl.trim() || null });
      if (token) setSession(token, res.user);
      setStatus(t('profile.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.saveFailed'));
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-xl font-bold">{t('profile.title')}</h1>
      {calendarBanner && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            calendarBanner.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {calendarBanner.text}
        </div>
      )}
      <div className="card space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={fullName || user.fullName} url={avatarUrl || user.avatarUrl} size={64} />
          <div>
            <div className="font-semibold">{user.fullName}</div>
            <div className="text-sm text-slate-500">{user.email}</div>
            <div className="mt-1 text-xs text-slate-400">{t('profile.role', { role: user.role })}</div>
          </div>
        </div>
        <form onSubmit={save} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('profile.fullName')}</span>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('profile.birthdate')}</span>
            <input className="input" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">{t('profile.avatarUrl')}</span>
            <input className="input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          </label>
          {status && <p className="text-sm text-emerald-600">{status}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="submit" className="btn-primary w-full">
            {t('common.saveChanges')}
          </button>
        </form>
      </div>
    </div>
  );
}
