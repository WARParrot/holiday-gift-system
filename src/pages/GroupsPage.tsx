/**
 * Scenario 1 + 2 (group flavour): the master directory of groups.
 *
 * Shows every group, its members with upcoming birthdays, and a whole-group
 * subscription toggle.
 */

import { useApp } from '../context/AppContext';
import type { Navigate } from '../navigation';
import { daysUntilBirthday, formatBirthday } from '../utils/dates';

export function GroupsPage({ navigate }: { navigate: Navigate }) {
  const { groups, users, isSubscribed, toggleSubscription } = useApp();

  return (
    <div>
      <h1>Groups</h1>
      <p className="muted">Discover and subscribe to social groups.</p>

      <div className="group-list">
        {groups.map((group) => {
          const members = users.filter((u) => group.memberIds.includes(u.id));
          const subscribed = isSubscribed('group', group.id);
          return (
            <div key={group.id} className="group-card">
              <div className="group-head">
                <div>
                  <h2>{group.name}</h2>
                  <p className="muted">
                    {group.description} · {group.visibility}
                  </p>
                </div>
                <button
                  type="button"
                  className={subscribed ? 'sub-btn active' : 'sub-btn'}
                  onClick={() => toggleSubscription('group', group.id)}
                >
                  {subscribed ? '✓ Subscribed' : '+ Subscribe'}
                </button>
              </div>

              <ul className="member-list">
                {members.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        navigate({ name: 'friend', userId: m.id })
                      }
                    >
                      {m.avatar} {m.fullName}
                    </button>
                    <span className="muted">
                      🎂 {formatBirthday(m.birthDate)} · in{' '}
                      {daysUntilBirthday(m.birthDate)}d
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
