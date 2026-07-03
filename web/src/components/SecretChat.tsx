import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useChatSocket } from '../hooks/useChatSocket';
import { useAuth } from '../store/auth';
import { formatDateTime } from './format';
import type { CrowdfundingPool, PoolContribution } from '../types/domain';

/**
 * Scenario 4 — Secret Chat Coordination (WebSocket validation).
 * Live message stream + the pinned crowdfunding progress widget.
 */
export function SecretChat({ roomId, subjectName }: { roomId: string; subjectName: string }) {
  const me = useAuth((s) => s.user);
  const { connected, messages, pool, error, send, setPool } = useChatSocket(roomId);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="card flex h-[36rem] flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <div>
          <h2 className="font-semibold">🤫 Secret chat</h2>
          <p className="text-xs text-slate-400">Planning {subjectName}'s celebration — invisible to them</p>
        </div>
        <span className={`badge ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {connected ? 'live' : 'connecting…'}
        </span>
      </div>

      <PoolWidget roomId={roomId} pool={pool} onPool={setPool} />

      <div ref={scrollRef} className="mt-2 flex-1 space-y-2 overflow-y-auto py-2">
        {messages.length === 0 && <p className="text-center text-sm text-slate-400">No messages yet. Start planning!</p>}
        {messages.map((m) => {
          const mine = m.authorId === me?.id;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {!mine && <p className="text-xs font-semibold opacity-70">{m.authorName}</p>}
                <p>{m.body}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{formatDateTime(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <form
        className="mt-2 flex gap-2 border-t border-slate-100 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            send(draft);
            setDraft('');
          }
        }}
      >
        <input className="input" placeholder="Message the planning team…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn-primary" type="submit" disabled={!connected}>
          Send
        </button>
      </form>
    </div>
  );
}

function PoolWidget({
  roomId,
  pool,
  onPool,
}: {
  roomId: string;
  pool: CrowdfundingPool | null;
  onPool: (p: CrowdfundingPool) => void;
}) {
  const { user, token, setSession } = useAuth();
  const [contributions, setContributions] = useState<PoolContribution[]>([]);
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPool, setLocalPool] = useState<CrowdfundingPool | null>(pool);

  async function refresh() {
    const r = await api.roomPool(roomId);
    setLocalPool(r.pool);
    setContributions(r.contributions);
  }

  useEffect(() => {
    void refresh();
  }, [roomId]);

  useEffect(() => {
    if (pool) setLocalPool(pool);
  }, [pool]);

  const active = localPool;
  if (!active) {
    return (
      <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        No gift pool yet — one opens automatically as the birthday approaches.
      </div>
    );
  }

  const pct = Math.min(100, Math.round((active.currentBalance / active.targetAmount) * 100));
  const reached = active.currentBalance >= active.targetAmount;

  async function contribute(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    try {
      const res = await api.contribute(roomId, value);
      setLocalPool(res.pool);
      onPool(res.pool);
      // Keep the header/profile balance in sync after the debit.
      if (user && token && typeof res.balance === 'number') {
        setSession(token, { ...user, balance: res.balance });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Contribution failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-emerald-800">🎁 Gift pool</span>
        <span className="text-emerald-700">
          ${active.currentBalance.toFixed(2)} / ${active.targetAmount.toFixed(2)} ({pct}%)
        </span>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-emerald-100">
        <div
          className={`h-full transition-all ${reached ? 'bg-emerald-600' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {reached && <p className="mt-1 text-[11px] font-medium text-emerald-700">🎉 Target reached!</p>}

      {active.status === 'CLOSED' ? (
        <p className="mt-2 text-xs text-slate-500">This pool is closed to new contributions.</p>
      ) : (
        <form className="mt-2 flex gap-2" onSubmit={contribute}>
          <input
            type="number"
            min="1"
            className="input py-1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button className="btn-primary py-1 text-xs" disabled={busy}>
            {busy ? '…' : 'Contribute'}
          </button>
        </form>
      )}
      {typeof user?.balance === 'number' && (
        <p className="mt-1 text-[11px] text-emerald-700">Your balance: ${user.balance.toFixed(2)}</p>
      )}
      {error && <p className="mt-1 text-[11px] font-medium text-rose-600">{error}</p>}

      {contributions.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-emerald-100 pt-2">
          {contributions.slice(-4).reverse().map((c) => (
            <li key={c.id} className="flex justify-between text-[11px] text-emerald-800">
              <span>{c.contributorName}</span>
              <span className="font-medium">+${c.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
