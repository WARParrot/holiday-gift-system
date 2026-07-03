/** Simple dropdown panel listing in-app notifications. */

import { useApp } from '../context/AppContext';
import { formatDateTime } from '../utils/dates';

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { notifications, markNotificationsRead } = useApp();

  return (
    <div className="notifications-panel">
      <div className="notifications-head">
        <strong>Notifications</strong>
        <div>
          <button type="button" onClick={markNotificationsRead}>
            Mark all read
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {notifications.length === 0 ? (
        <p className="muted">You're all caught up.</p>
      ) : (
        <ul className="notifications-list">
          {notifications.map((n) => (
            <li key={n.id} className={n.read ? 'read' : 'unread'}>
              <p>{n.message}</p>
              <span className="muted">{formatDateTime(n.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
