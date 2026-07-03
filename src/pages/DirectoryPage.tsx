/**
 * Scenario 1 + 2: Discovery/Directory and Subscription setup.
 *
 * Lists all users (except the current user) with their upcoming birthday and a
 * per-friend subscription toggle. Clicking a card opens the Friend Card.
 */

import { useApp } from '../context/AppContext';
import type { Navigate } from '../navigation';
import { daysUntilBirthday, formatBirthday } from '../utils/dates';

export function DirectoryPage({ navigate }: { navigate: Navigate }) {
  const { users, currentUser, isSubscribed, toggleSubscription } = useApp();
  const friends = users.filter((u) => u.id !== currentUser.id);

  return (
    <div>
      <h1>User Directory</h1>
      <p className="muted">
        Discover friends and review their upcoming birthdays.
      </p>

      <div className="card-grid">
        {friends.map((user) => {
          const days = daysUntilBirthday(user.birthDate);
          const subscribed = isSubscribed('friend', user.id);
          return (
            <div key={user.id} className="card">
              <button
                type="button"
                className="card-main"
                onClick={() => navigate({ name: 'friend', userId: user.id })}
              >
                <span className="avatar">{user.avatar}</span>
                <div>
                  <div className="card-name">{user.fullName}</div>
                  <div className="muted">
                    🎂 {formatBirthday(user.birthDate)} · in {days} day
                    {days === 1 ? '' : 's'}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className={subscribed ? 'sub-btn active' : 'sub-btn'}
                onClick={() => toggleSubscription('friend', user.id)}
              >
                {subscribed ? '✓ Subscribed' : '+ Subscribe'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
