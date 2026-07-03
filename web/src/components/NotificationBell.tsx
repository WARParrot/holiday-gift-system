import { useEffect, useState } from 'react';
import { useNotifications } from '../store/notifications';
import { useNotificationSocket } from '../hooks/useNotificationSocket';
import { formatDateTime } from './format';

const TYPE_STYLES: Record<string, string> = {
  REMINDER: 'bg-amber-100 text-amber-800',
  POOL_OPENED: 'bg-emerald-100 text-emerald-800',
  CHAT_MESSAGE: 'bg-sky-100 text-sky-800',
  SYSTEM: 'bg-slate-100 text-slate-700',
};

export function NotificationBell() {
  const { items, unread, refresh, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  // Live push over WS keeps the bell current; the poll is a periodic fallback.
  useNotificationSocket();

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="relative">
      <button className="btn-ghost relative" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 p-3">
            <span className="font-semibold">Notifications</span>
            <button className="text-xs text-brand-600 hover:underline" onClick={() => markAllRead()}>
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="p-4 text-sm text-slate-500">No notifications yet.</p>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`block w-full border-b border-slate-50 p-3 text-left hover:bg-slate-50 ${n.read ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`badge ${TYPE_STYLES[n.type] ?? TYPE_STYLES.SYSTEM}`}>{n.type}</span>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                  <span className="ml-auto text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-800">{n.title}</p>
                <p className="text-xs text-slate-500">{n.body}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
