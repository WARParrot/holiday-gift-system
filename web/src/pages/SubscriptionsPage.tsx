import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DirectoryUser, GroupWithMeta, Subscription } from '../types/domain';
import { Loading, ErrorNote, Empty } from '../components/Feedback';
import { formatBirthdayCountdown } from '../components/format';

/**
 * Scenario 2 — Subscription setup hub. Shows current subscriptions. Reminder
 * and pool scheduling runs automatically on the server; manual scheduler ticks
 * belong on the admin/demo surface, not a user's subscription page.
 */
export function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<GroupWithMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([api.subscriptions(), api.directory(), api.groups()])
      .then(([s, u, g]) => {
        setSubs(s.subscriptions);
        setUsers(u.users);
        setGroups(g.groups);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load subscriptions'));
  };
  useEffect(load, []);

  async function unsub(sub: Subscription) {
    await api.unsubscribe({ kind: sub.kind, targetId: sub.targetId });
    load();
  }

  if (error) return <ErrorNote message={error} />;
  if (!subs) return <Loading label="Loading subscriptions…" />;

  const label = (sub: Subscription) => {
    if (sub.kind === 'FRIEND') {
      const u = users.find((x) => x.id === sub.targetId);
      return { name: u?.fullName ?? 'Unknown friend', to: `/friends/${sub.targetId}`, meta: u ? formatBirthdayCountdown(u.daysUntilBirthday) : '' };
    }
    const g = groups.find((x) => x.id === sub.targetId);
    return { name: g?.name ?? 'Unknown group', to: `/groups/${sub.targetId}`, meta: g ? `${g.memberCount} members` : '' };
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold">My subscriptions</h1>
        <p className="mt-1 text-xs text-slate-400">
          Birthday reminders and gift pools are opened automatically by the server as birthdays approach.
        </p>
      </div>

      {subs.length === 0 && <Empty label="You haven't subscribed to anyone yet. Open a Friend Card or Group to subscribe." />}
      <div className="space-y-3">
        {subs.map((sub) => {
          const info = label(sub);
          return (
            <div key={sub.id} className="card flex items-center justify-between">
              <div>
                <span className="badge mr-2 bg-slate-100 text-slate-600">{sub.kind}</span>
                <Link to={info.to} className="font-medium hover:text-brand-600">
                  {info.name}
                </Link>
                <p className="mt-1 text-xs text-slate-400">
                  {info.meta}
                  {sub.calendarSync && ' · 📅 calendar sync on'}
                </p>
              </div>
              <button className="btn-ghost" onClick={() => unsub(sub)}>
                Unsubscribe
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
