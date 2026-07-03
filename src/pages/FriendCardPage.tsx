/**
 * Scenario 3 + 4: the Friend Card detail view.
 *
 * Aggregates personal data, shared groups, the wishlist, and the Secret
 * Celebration Chat (hidden when viewing your own card).
 */

import { SecretChat } from '../components/SecretChat';
import { Wishlist } from '../components/Wishlist';
import { useApp } from '../context/AppContext';
import type { ID } from '../types';
import { daysUntilBirthday, formatBirthday } from '../utils/dates';

export function FriendCardPage({ userId }: { userId: ID }) {
  const { users, groups, currentUser, isSubscribed, toggleSubscription } =
    useApp();

  const user = users.find((u) => u.id === userId);
  if (!user) return <p>User not found.</p>;

  const isSelf = user.id === currentUser.id;
  const sharedGroups = groups.filter((g) => user.groupIds.includes(g.id));
  const days = daysUntilBirthday(user.birthDate);

  return (
    <div className="friend-card">
      <header className="friend-header">
        <span className="avatar large">{user.avatar}</span>
        <div>
          <h1>{user.fullName}</h1>
          <p className="muted">
            🎂 {formatBirthday(user.birthDate)} · in {days} day
            {days === 1 ? '' : 's'}
          </p>
        </div>
        {!isSelf && (
          <button
            type="button"
            className={
              isSubscribed('friend', user.id) ? 'sub-btn active' : 'sub-btn'
            }
            onClick={() => toggleSubscription('friend', user.id)}
          >
            {isSubscribed('friend', user.id) ? '✓ Subscribed' : '+ Subscribe'}
          </button>
        )}
      </header>

      <section>
        <h2>Groups</h2>
        {sharedGroups.length === 0 ? (
          <p className="muted">No groups.</p>
        ) : (
          <ul className="tag-list">
            {sharedGroups.map((g) => (
              <li key={g.id} className="tag">
                {g.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Wishlist</h2>
        <Wishlist items={user.wishlist} editable={isSelf} />
      </section>

      <section>
        <h2>Secret Celebration Chat</h2>
        {isSelf ? (
          <p className="muted">
            This is your own card — the secret chat is hidden from you.
          </p>
        ) : (
          <SecretChat friendCardUserId={user.id} />
        )}
      </section>
    </div>
  );
}
