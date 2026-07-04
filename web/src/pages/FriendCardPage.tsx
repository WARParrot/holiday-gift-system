import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { FriendCard, FriendStatus, WishlistItem } from '../types/domain';
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
  const { t } = useTranslation();
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
      .catch((e) => setError(e instanceof Error ? e.message : t('friendCard.loadFailed')));
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
  if (!card) return <Loading label={t('friendCard.loading')} />;

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
              <FriendControls userId={card.user.id} name={card.user.fullName} state={card.friendState} onChanged={load} />
              {card.friendState === 'friends' ? (
                <>
                  <button className={subscribed ? 'btn-ghost' : 'btn-primary'} onClick={toggleSubscribe}>
                    {subscribed ? t('friendCard.subscribed') : t('friendCard.subscribe')}
                  </button>
                  {!subscribed && (
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={calendarSync} onChange={(e) => setCalendarSync(e.target.checked)} />
                      {t('friendCard.addToCalendar')}
                    </label>
                  )}
                </>
              ) : (
                <span className="text-sm text-slate-400">{t('friendCard.becomeFriends')}</span>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold">{t('friendCard.sharedGroups')}</h2>
          {card.groups.length === 0 ? (
            <p className="text-sm text-slate-400">{t('friendCard.notInGroups')}</p>
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
            <h2 className="font-semibold">{t('friendCard.secretChatTitle')}</h2>
            {card.isSelf ? (
              <p className="mt-2 text-sm text-slate-500">
                {t('friendCard.ownCardHidden')}
              </p>
            ) : card.secretChat.eligible ? (
              <JoinSecretChat subjectId={card.user.id} onJoined={load} />
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                {t('friendCard.subscribeToJoin', { name: card.user.fullName })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FriendControls({ userId, name, state, onChanged }: { userId: string; name: string; state: FriendStatus; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (state === 'friends') {
    return <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.removeFriend(userId))}>{t('friendCard.stateFriends')}</button>;
  }
  if (state === 'pending_outgoing') {
    return <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.removeFriend(userId))}>{t('friendCard.cancelRequest')}</button>;
  }
  if (state === 'pending_incoming') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">{t('friendCard.sentYouRequest', { name })}</span>
        <button className="btn-primary" disabled={busy} onClick={() => run(() => api.acceptFriend(userId))}>{t('common.accept')}</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.removeFriend(userId))}>{t('common.decline')}</button>
      </div>
    );
  }
  return <button className="btn-primary" disabled={busy} onClick={() => run(() => api.sendFriendRequest(userId))}>{t('friendCard.addFriend')}</button>;
}

function JoinSecretChat({ subjectId, onJoined }: { subjectId: string; onJoined: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.joinSubjectRoom(subjectId);
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('friendCard.couldNotJoin'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-slate-500">
        {t('friendCard.joinEligible')}
      </p>
      <button className="btn-primary" onClick={join} disabled={busy}>
        {busy ? t('friendCard.joining') : t('friendCard.joinButton')}
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
  const { t } = useTranslation();
  async function suggest(item: WishlistItem) {
    const next = item.status === 'OPEN' ? 'SUGGESTED' : 'OPEN';
    await api.setWishlistStatus(item.id, next);
    onChange();
  }

  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">{t('friendCard.wishlist')}</h2>
      {items.length === 0 && <p className="text-sm text-slate-400">{t('friendCard.noWishlist')}</p>}
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
                        {t('friendCard.link')}
                      </a>
                    )}
                    {item.status !== 'OPEN' && (
                      <span className="badge bg-emerald-100 text-emerald-700">{t(`wishlistStatus.${item.status}`)}</span>
                    )}
                  </div>
                </div>
                {!isSelf && viewerId && (
                  <button className="btn-ghost text-xs" onClick={() => suggest(item)}>
                    {item.status === 'OPEN' ? t('friendCard.markSuggested') : t('friendCard.unmark')}
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
