import { useEffect } from 'react';
import { getToken } from '../api/client';
import { useNotifications } from '../store/notifications';
import type { WsServerFrame } from '../types/domain';

/**
 * Opens a persistent WebSocket for the logged-in user and folds live
 * notification pushes into the notification store. Unlike `useChatSocket` it
 * never joins a room — it only authenticates and listens — so the bell updates
 * instantly on new chat/reminder/pool notifications instead of waiting for the
 * 15s poll. The REST poll remains as a fallback if the socket drops.
 */
export function useNotificationSocket(): void {
  const applyPush = useNotifications((s) => s.applyPush);
  const removeNotification = useNotifications((s) => s.removeNotification);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (event) => {
      const frame = JSON.parse(event.data as string) as WsServerFrame;
      if (frame.type === 'notification') applyPush(frame.notification);
      else if (frame.type === 'notification-removed') removeNotification(frame.id);
    };

    return () => {
      // Detach handlers before closing so a socket aborted mid-handshake (e.g.
      // StrictMode's double-mount) can't push into a torn-down store binding.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    };
  }, [applyPush, removeNotification]);
}
