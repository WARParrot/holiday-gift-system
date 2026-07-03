import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { Avatar } from './Avatar';
import { formatDateTime } from './format';
import type { CalendarConnection, CalendarProviderName, WalletTransaction } from '../types/domain';

type Tab = 'account' | 'payment' | 'calendar';

/**
 * Slide-over profile widget opened by clicking the header avatar. Hosts three
 * subpages: Account settings, Payment (wallet balance + top-up + ledger), and
 * Calendar (Google/Yandex connections).
 */
export function ProfileWidget({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('account');
  if (!user) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-100 p-4">
          <Avatar name={user.fullName} url={user.avatarUrl} size={48} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.fullName}</p>
            <p className="truncate text-sm text-slate-500">{user.email}</p>
          </div>
          <button className="btn-ghost ml-auto text-xs" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
          <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
            Balance: ${user.balance.toFixed(2)}
          </span>
        </div>

        <nav className="flex border-b border-slate-100">
          {(['account', 'payment', 'calendar'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-brand-500 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'account' && <AccountTab onClose={onClose} />}
          {tab === 'payment' && <PaymentTab />}
          {tab === 'calendar' && <CalendarTab />}
        </div>

        <footer className="border-t border-slate-100 p-3">
          <button
            className="btn-ghost w-full"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            Log out
          </button>
        </footer>
      </aside>
    </div>
  );
}

function AccountTab({ onClose }: { onClose: () => void }) {
  const { user, token, setSession } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [birthdate, setBirthdate] = useState(user?.birthdate ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setError(null);
    try {
      const res = await api.updateMe({ fullName: fullName.trim(), birthdate, avatarUrl: avatarUrl.trim() || null });
      if (token) setSession(token, res.user);
      setStatus('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h3 className="font-semibold">Account settings</h3>
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
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1">
          Save changes
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </form>
  );
}

const KIND_LABEL: Record<string, string> = {
  TOPUP: 'Top-up',
  CONTRIBUTION: 'Gift contribution',
  ADMIN_ADJUST: 'Admin adjustment',
  REFUND: 'Refund',
};

function PaymentTab() {
  const { user, token, setSession } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [amount, setAmount] = useState('50');
  const [method, setMethod] = useState('Visa •• 4242');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const w = await api.wallet();
    setBalance(w.balance);
    setTxns(w.transactions);
  }
  useEffect(() => {
    void load();
  }, []);

  async function topUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.topUp(Number(amount), method);
      setBalance(res.balance);
      // Keep the header balance chip in sync.
      if (user && token) setSession(token, { ...user, balance: res.balance });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Top-up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Payment &amp; balance</h3>
        <p className="mt-1 text-2xl font-bold text-emerald-700">
          ${(balance ?? user?.balance ?? 0).toFixed(2)}
        </p>
        <p className="text-xs text-slate-400">Available wallet balance</p>
      </div>

      <form onSubmit={topUp} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-600">Add funds</p>
        <div className="flex gap-2">
          <input type="number" min="1" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Card label" />
        </div>
        <p className="text-[11px] text-slate-400">
          Demo payments use a mock gateway — no real card is charged. The label is display-only.
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Processing…' : `Add $${Number(amount) || 0}`}
        </button>
      </form>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-600">Recent transactions</p>
        {txns.length === 0 ? (
          <p className="text-sm text-slate-400">No transactions yet.</p>
        ) : (
          <ul className="space-y-1">
            {txns.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{KIND_LABEL[t.kind] ?? t.kind}</p>
                  <p className="text-xs text-slate-400">{t.memo || formatDateTime(t.createdAt)}</p>
                </div>
                <span className={`font-semibold ${t.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {t.amount >= 0 ? '+' : ''}
                  {t.amount.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const PROVIDERS: { id: CalendarProviderName; label: string }[] = [
  { id: 'google', label: 'Google Calendar' },
  { id: 'yandex', label: 'Yandex Calendar' },
];

function CalendarTab() {
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({ google: '', yandex: '' });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await api.calendarConnections();
    setConnections(r.connections);
  }
  useEffect(() => {
    void load();
  }, []);

  const connected = (p: CalendarProviderName) => connections.find((c) => c.provider === p);

  async function connect(p: CalendarProviderName) {
    setError(null);
    setStatus(null);
    const label = labels[p]?.trim() || `${p}-account`;
    try {
      const res = await api.connectCalendar(p, label);
      setStatus(`Connected ${p}. Synced ${res.eventsSynced} event(s) from your subscriptions.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed');
    }
  }

  async function disconnect(p: CalendarProviderName) {
    await api.disconnectCalendar(p);
    await load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Calendar connections</h3>
        <p className="mt-1 text-xs text-slate-400">
          Connect a calendar to auto-add birthday events for people/groups you subscribe to with calendar sync enabled.
        </p>
      </div>
      {PROVIDERS.map((p) => {
        const conn = connected(p.id);
        return (
          <div key={p.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{p.label}</span>
              {conn ? (
                <span className="badge bg-emerald-100 text-emerald-700">Connected</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-500">Not connected</span>
              )}
            </div>
            {conn ? (
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">{conn.accountLabel}</span>
                <button className="btn-ghost text-xs" onClick={() => disconnect(p.id)}>
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  className="input"
                  placeholder="account label / email"
                  value={labels[p.id] ?? ''}
                  onChange={(e) => setLabels({ ...labels, [p.id]: e.target.value })}
                />
                <button className="btn-primary text-xs" onClick={() => connect(p.id)}>
                  Connect
                </button>
              </div>
            )}
          </div>
        );
      })}
      {status && <p className="text-sm text-emerald-600">{status}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
