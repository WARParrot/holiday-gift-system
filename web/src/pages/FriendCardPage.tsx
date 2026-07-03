import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { FriendCard, WishlistItem } from '../types/domain';
import { useAuth } from '../store/auth';
import { Avatar } from '../components/Avatar';
import { Loading, ErrorNote } from '../components/Feedback';
import { formatBirthdayCountdown, formatPriceRange } from '../components/format';
import { SecretChat } from '../components/SecretChat';

/**
 * Friend Card — aggregates personal data, shared groups, wishlist (scenario 3),
 * and the secret coordination chat (scenario 4). The chat pane is only rendered
 * when the backend says it's visible (i.e. the viewer is NOT the subject).
 */
export function FriendCardPage() {
  const { userId } = useParams<{ userId: string }>();
  const me = useAuth((s) => s.user);
  const [card, setCard] = useState<FriendCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [calendarSync, setCalendarSync] = useState(false);

  const load = () => {
    if (!userId) return;
    api
      .friendCard(userId)
      .then(setCard)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load friend card'));
  };

  useEffect(load, [userId]);

  useEffect(() => {
    api.subscriptions().then((r) => {
      setSubscribed(r.subscriptions.some((s) => s.kind === 'FRIEND' && s.targetId === userId));
    });
  }, [userId]);

  async function toggleSubscribe() {
    if (!userId) return;
    if (subscribed) {
      await api.unsubscribe({ kind: 'FRIEND', targetId: userId });
      setSubscribed(false);
    } else {
      await api.subscribe({ kind: 'FRIEND', targetId: userId, calendarSync });
      setSubscribed(true);
    }
    // Refresh the card so secret-chat eligibility reflects the new state.
    load();
  }

  if (error) return <ErrorNote message={error} />;
  if (!card) return <Loading label="Loading friend card…" />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <div className="card">
          <div className="flex items-center gap-4">
            <Avatar name={card.user.fullName} url={card.user.avatarUrl} size={64} />
            <div>
              <h1 className="text-xl font-bold">{card.user.fullName}</h1>
              <p className="text-sm text-slate-500">🎂 {formatBirthdayCountdown(card.daysUntilBirthday)}</p>
              <p className="text-xs text-slate-400">{card.user.birthdate}</p>
            </div>
          </div>

          {!card.isSelf && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <button className={subscribed ? 'btn-ghost' : 'btn-primary'} onClick={toggleSubscribe}>
                {subscribed ? '✓ Subscribed' : 'Subscribe to reminders'}
              </button>
              {!subscribed && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={calendarSync} onChange={(e) => setCalendarSync(e.target.checked)} />
                  Add to my calendar
                </label>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold">Shared &amp; member groups</h2>
          {card.groups.length === 0 ? (
            <p className="text-sm text-slate-400">Not in any groups.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {card.groups.map((g) => (
                <span key={g.id} className="badge bg-slate-100 text-slate-700">
                  {g.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <WishlistPanel items={card.wishlist} isSelf={card.isSelf} onChange={load} viewerId={me?.id ?? ''} />
      </div>

      <div>
        {card.secretChat.visible ? (
          <SecretChat roomId={card.secretChat.roomId} subjectName={card.user.fullName} />
        ) : (
          <div className="card">
            <h2 className="font-semibold">Secret coordination chat</h2>
            {card.isSelf ? (
              <p className="mt-2 text-sm text-slate-500">
                This is your own card — the celebration chat about you is hidden from you by design. 🤫
              </p>
            ) : card.secretChat.eligible ? (
              <JoinSecretChat subjectId={card.user.id} onJoined={load} />
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Subscribe to {card.user.fullName}'s reminders to join the secret planning chat.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function JoinSecretChat({ subjectId, onJoined }: { subjectId: string; onJoined: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.joinSubjectRoom(subjectId);
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the chat');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-slate-500">
        You're eligible to help plan this celebration. Join the secret chat to coordinate — the birthday person can
        never see it. 🤫
      </p>
      <button className="btn-primary" onClick={join} disabled={busy}>
        {busy ? 'Joining…' : 'Join secret chat'}
      </button>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}

function WishlistPanel({
  items,
  isSelf,
  viewerId,
  onChange,
}: {
  items: WishlistItem[];
  isSelf: boolean;
  viewerId: string;
  onChange: () => void;
}) {
  async function suggest(item: WishlistItem) {
    const next = item.status === 'OPEN' ? 'SUGGESTED' : 'OPEN';
    await api.setWishlistStatus(item.id, next);
    onChange();
  }

  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Wishlist</h2>
      {items.length === 0 && <p className="text-sm text-slate-400">No wishlist items yet.</p>}
      <ul className="space-y-2">
        {items.map((item) => {
          const price = formatPriceRange(item.priceMin, item.priceMax);
          return (
            <li key={item.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.title}</p>
                  {item.description && <p className="text-sm text-slate-500">{item.description}</p>}
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    {price && <span className="text-slate-500">{price}</span>}
                    {item.link && (
                      <a href={item.link} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                        link ↗
                      </a>
                    )}
                    {item.status !== 'OPEN' && (
                      <span className="badge bg-emerald-100 text-emerald-700">{item.status}</span>
                    )}
                  </div>
                </div>
                {!isSelf && viewerId && (
                  <button className="btn-ghost text-xs" onClick={() => suggest(item)}>
                    {item.status === 'OPEN' ? 'Mark suggested' : 'Unmark'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
