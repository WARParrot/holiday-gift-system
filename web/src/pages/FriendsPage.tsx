import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { PublicUser } from '../types/domain';
import { Avatar } from '../components/Avatar';
import { Empty, ErrorNote, Loading } from '../components/Feedback';

export function FriendsPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<{ friends: PublicUser[]; incoming: PublicUser[]; outgoing: PublicUser[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.friends().then(setData).catch((e) => setError(e instanceof Error ? e.message : t('friends.loadFailed')));
  useEffect(() => { void load(); }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading label={t('friends.loading')} />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{t('friends.title')}</h1>

      {data.incoming.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t('friends.requests')}</h2>
          <div className="space-y-2">
            {data.incoming.map((u) => (
              <div key={u.id} className="card flex items-center justify-between">
                <PersonLink user={u} />
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={busy} onClick={() => act(() => api.acceptFriend(u.id))}>{t('common.accept')}</button>
                  <button className="btn-ghost" disabled={busy} onClick={() => act(() => api.removeFriend(u.id))}>{t('common.decline')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">{t('friends.myFriends', { count: data.friends.length })}</h2>
        {data.friends.length === 0 ? <Empty label={t('friends.noFriends')} /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.friends.map((u) => (
              <div key={u.id} className="card flex items-center justify-between">
                <PersonLink user={u} />
                <button className="btn-ghost text-xs" disabled={busy} onClick={() => act(() => api.removeFriend(u.id))}>{t('friends.unfriend')}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t('friends.sentRequests')}</h2>
          <div className="space-y-2">
            {data.outgoing.map((u) => (
              <div key={u.id} className="card flex items-center justify-between">
                <PersonLink user={u} />
                <button className="btn-ghost" disabled={busy} onClick={() => act(() => api.removeFriend(u.id))}>{t('common.cancel')}</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PersonLink({ user }: { user: PublicUser }) {
  return (
    <Link to={`/friends/${user.id}`} className="flex items-center gap-3">
      <Avatar name={user.fullName} url={user.avatarUrl} size={40} />
      <span className="font-medium">{user.fullName}</span>
    </Link>
  );
}
