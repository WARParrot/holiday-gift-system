import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Group, GroupMemberView } from '../types/domain';
import { Avatar } from '../components/Avatar';
import { Loading, ErrorNote } from '../components/Feedback';
import { formatBirthdayCountdown } from '../components/format';

/**
 * Group detail — members sorted by upcoming birthday, plus a one-click
 * "subscribe to the whole group" action (scenario 2).
 */
export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [data, setData] = useState<{ group: Group; members: GroupMemberView[]; isMember: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [calendarSync, setCalendarSync] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    api
      .group(groupId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load group'));
    api.subscriptions().then((r) => setSubscribed(r.subscriptions.some((s) => s.kind === 'GROUP' && s.targetId === groupId)));
  }, [groupId]);

  async function toggleSubscribe() {
    if (!groupId) return;
    if (subscribed) {
      await api.unsubscribe({ kind: 'GROUP', targetId: groupId });
      setSubscribed(false);
    } else {
      await api.subscribe({ kind: 'GROUP', targetId: groupId, calendarSync });
      setSubscribed(true);
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading label="Loading group…" />;

  return (
    <div>
      <div className="card mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{data.group.name}</h1>
            <p className="text-sm text-slate-500">{data.group.description || 'No description'}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button className={subscribed ? 'btn-ghost' : 'btn-primary'} onClick={toggleSubscribe}>
              {subscribed ? '✓ Subscribed to group' : 'Subscribe to whole group'}
            </button>
            {!subscribed && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={calendarSync} onChange={(e) => setCalendarSync(e.target.checked)} />
                Add all to calendar
              </label>
            )}
          </div>
        </div>
      </div>

      <h2 className="mb-2 font-semibold">Members &amp; upcoming birthdays</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.members.map((m) => (
          <Link key={m.userId} to={`/friends/${m.userId}`} className="card flex items-center gap-3 hover:shadow-md">
            <Avatar name={m.fullName} url={m.avatarUrl} size={44} />
            <div>
              <p className="font-medium">{m.fullName}</p>
              <p className="text-sm text-slate-500">🎂 {formatBirthdayCountdown(m.daysUntilBirthday)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
