import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { Avatar } from '../components/Avatar';

/** Profile management — edit full name, birthdate, and avatar URL. */
export function ProfilePage() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const token = useAuth((s) => s.token);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [birthdate, setBirthdate] = useState(user?.birthdate ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setError(null);
    try {
      const res = await api.updateMe({ fullName: fullName.trim(), birthdate, avatarUrl: avatarUrl.trim() || null });
      if (token) setSession(token, res.user);
      setStatus('Profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-xl font-bold">My profile</h1>
      <div className="card space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={fullName || user.fullName} url={avatarUrl || user.avatarUrl} size={64} />
          <div>
            <div className="font-semibold">{user.fullName}</div>
            <div className="text-sm text-slate-500">{user.email}</div>
            <div className="mt-1 text-xs text-slate-400">Role: {user.role}</div>
          </div>
        </div>
        <form onSubmit={save} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Full name</span>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Birthdate</span>
            <input className="input" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Avatar URL (optional)</span>
            <input className="input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          </label>
          {status && <p className="text-sm text-emerald-600">{status}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="submit" className="btn-primary w-full">
            Save changes
          </button>
        </form>
      </div>
    </div>
  );
}
