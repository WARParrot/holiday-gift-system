import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { LANGUAGES, setLanguage, type LanguageCode } from '../i18n';
import { Avatar } from './Avatar';
import { formatDateTime } from './format';
import type { CalendarConnection, CalendarProviderName, WalletTransaction } from '../types/domain';

type Tab = 'account' | 'payment' | 'calendar';

const TAB_KEYS: Record<Tab, string> = {
  account: 'widget.tabAccount',
  payment: 'widget.tabPayment',
  calendar: 'widget.tabCalendar',
};

/**
 * Slide-over profile widget opened by clicking the header avatar. Hosts three
 * subpages: Account settings, Payment (wallet balance + top-up + ledger), and
 * Calendar (Google/Yandex connections).
 */
export function ProfileWidget({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('account');
  if (!user) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-black/30" aria-label={t('widget.close')} onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-100 p-4">
          <Avatar name={user.fullName} url={user.avatarUrl} size={48} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.fullName}</p>
            <p className="truncate text-sm text-slate-500">{user.email}</p>
          </div>
          <button className="btn-ghost ml-auto text-xs" onClick={onClose}>
            {t('widget.close')}
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
          <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
            {t('widget.balance', { amount: user.balance.toFixed(2) })}
          </span>
        </div>

        <nav className="flex border-b border-slate-100">
          {(['account', 'payment', 'calendar'] as Tab[]).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`flex-1 px-3 py-2 text-sm font-medium ${tab === tabKey ? 'border-b-2 border-brand-500 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t(TAB_KEYS[tabKey])}
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
            {t('widget.logOut')}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function AccountTab({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
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
      setStatus(t('widget.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.saveFailed'));
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <h3 className="font-semibold">{t('widget.accountSettings')}</h3>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">{t('widget.language')}</span>
        <select
          className="input"
          value={i18n.language.startsWith('ru') ? 'ru' : 'en'}
          onChange={(e) => setLanguage(e.target.value as LanguageCode)}
        >
          {LANGUAGES.map((lng) => (
            <option key={lng.code} value={lng.code}>
              {lng.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">{t('widget.fullName')}</span>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">{t('widget.birthdate')}</span>
        <input className="input" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} required />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">{t('widget.avatarUrl')}</span>
        <input className="input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
      </label>
      {status && <p className="text-sm text-emerald-600">{status}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1">
          {t('common.saveChanges')}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t('common.done')}
        </button>
      </div>
    </form>
  );
}

function PaymentTab() {
  const { t } = useTranslation();
  const KIND_LABEL: Record<string, string> = {
    TOPUP: t('widget.kindTOPUP'),
    CONTRIBUTION: t('widget.kindCONTRIBUTION'),
    ADMIN_ADJUST: t('widget.kindADMIN_ADJUST'),
    REFUND: t('widget.kindREFUND'),
  };
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
      setError(err instanceof Error ? err.message : t('widget.topUpFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('widget.paymentBalance')}</h3>
        <p className="mt-1 text-2xl font-bold text-emerald-700">
          ${(balance ?? user?.balance ?? 0).toFixed(2)}
        </p>
        <p className="text-xs text-slate-400">{t('widget.availableBalance')}</p>
      </div>

      <form onSubmit={topUp} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-600">{t('widget.addFunds')}</p>
        <div className="flex gap-2">
          <input type="number" min="1" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" value={method} onChange={(e) => setMethod(e.target.value)} placeholder={t('widget.cardLabel')} />
        </div>
        <p className="text-[11px] text-slate-400">
          {t('widget.demoPaymentNote')}
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? t('common.processing') : t('widget.addAmount', { amount: Number(amount) || 0 })}
        </button>
      </form>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-600">{t('widget.recentTx')}</p>
        {txns.length === 0 ? (
          <p className="text-sm text-slate-400">{t('widget.noTx')}</p>
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
  const { t } = useTranslation();
  const [connections, setConnections] = useState<Array<CalendarConnection & { live: boolean }>>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<CalendarProviderName | null>(null);
  // When Yandex signals CalDAV mode, we reveal an inline login + app-password
  // form instead of redirecting (Yandex Calendar uses Basic auth, not OAuth).
  const [yandexForm, setYandexForm] = useState<{ login: string; appPassword: string } | null>(null);

  async function load() {
    const r = await api.calendarConnections();
    setConnections(r.connections);
  }
  useEffect(() => {
    void load();
    // Surface the OAuth callback outcome if we've just been redirected back
    // (the server bounces to /profile?calendar=..&status=..&detail=..).
    const params = new URLSearchParams(window.location.search);
    const cal = params.get('calendar');
    const st = params.get('status');
    if (cal && st) {
      if (st === 'connected') setStatus(t('profile.calendarConnected', { provider: cal, detail: params.get('detail') ? ` (${params.get('detail')})` : '' }));
      else setError(t('profile.calendarError', { provider: cal, detail: params.get('detail') || 'unknown error' }));
      // Clean the query so a refresh doesn't re-show the banner.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const connected = (p: CalendarProviderName) => connections.find((c) => c.provider === p);

  async function connect(p: CalendarProviderName) {
    setError(null);
    setStatus(null);
    setBusy(p);
    try {
      const res = await api.startCalendarConnect(p);
      if (res.mode === 'oauth') {
        // Hand off to the provider's consent screen (full-page redirect).
        window.location.href = res.authorizeUrl;
        return;
      }
      if (res.mode === 'caldav') {
        // Yandex: reveal the login + app-password form (Basic-auth CalDAV).
        setYandexForm({ login: '', appPassword: '' });
        return;
      }
      // Demo mode: connected server-side immediately.
      setStatus(t('widget.statusConnectedDemo', { provider: p, count: res.eventsSynced }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('widget.connectFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function submitYandex(e: React.FormEvent) {
    e.preventDefault();
    if (!yandexForm) return;
    setError(null);
    setStatus(null);
    setBusy('yandex');
    try {
      const res = await api.connectYandexCalDav(yandexForm.login.trim(), yandexForm.appPassword.trim());
      setStatus(t('widget.statusConnectedYandex', { count: res.eventsSynced }));
      setYandexForm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('widget.yandexConnectFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(p: CalendarProviderName) {
    await api.disconnectCalendar(p);
    await load();
  }

  const anyDemo = connections.some((c) => !c.live) || PROVIDERS.some((p) => !(connected(p.id)?.live ?? true));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('widget.calendarConnections')}</h3>
        <p className="mt-1 text-xs text-slate-400">
          {t('widget.calendarHint')}
        </p>
        {anyDemo && (
          <p className="mt-1 text-[11px] font-medium text-amber-600">
            {t('widget.calendarDemoNote')}
          </p>
        )}
      </div>
      {PROVIDERS.map((p) => {
        const conn = connected(p.id);
        return (
          <div key={p.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {p.label}
                {conn && !conn.live && <span className="ml-2 text-[10px] font-semibold uppercase text-amber-600">{t('widget.demoBadge')}</span>}
              </span>
              {conn ? (
                <span className="badge bg-emerald-100 text-emerald-700">{t('widget.connected')}</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-500">{t('widget.notConnected')}</span>
              )}
            </div>
            {conn ? (
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">{conn.accountLabel}</span>
                <button className="btn-ghost text-xs" onClick={() => disconnect(p.id)}>
                  {t('common.disconnect')}
                </button>
              </div>
            ) : (
              <div className="mt-2">
                {p.id === 'yandex' && yandexForm ? (
                  <form onSubmit={submitYandex} className="space-y-2">
                    <p className="text-[11px] text-slate-500">
                      {t('widget.yandexHint')}
                    </p>
                    <input
                      className="input"
                      placeholder={t('widget.yandexLogin')}
                      autoComplete="username"
                      value={yandexForm.login}
                      onChange={(e) => setYandexForm({ ...yandexForm, login: e.target.value })}
                    />
                    <input
                      className="input"
                      type="password"
                      placeholder={t('widget.appPassword')}
                      autoComplete="off"
                      value={yandexForm.appPassword}
                      onChange={(e) => setYandexForm({ ...yandexForm, appPassword: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <button
                        className="btn-primary text-xs"
                        type="submit"
                        disabled={busy === 'yandex' || !yandexForm.login.trim() || !yandexForm.appPassword.trim()}
                      >
                        {busy === 'yandex' ? t('common.connecting') : t('common.connect')}
                      </button>
                      <button className="btn-ghost text-xs" type="button" onClick={() => setYandexForm(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button className="btn-primary text-xs" disabled={busy === p.id} onClick={() => connect(p.id)}>
                    {busy === p.id ? t('common.connecting') : t('widget.connectProvider', { provider: p.label })}
                  </button>
                )}
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
