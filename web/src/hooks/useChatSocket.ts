import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../api/client';
import type { ChatMessage, CrowdfundingPool, WsServerFrame } from '../types/domain';

interface UseChatSocketResult {
  connected: boolean;
  messages: ChatMessage[];
  pool: CrowdfundingPool | null;
  error: string | null;
  send: (body: string) => void;
  setPool: (pool: CrowdfundingPool) => void;
}

/**
 * Manages a single WebSocket connection to the secret-chat hub for one room.
 * Handles auth -> join -> live message/pool streaming, with graceful cleanup.
 */
export function useChatSocket(roomId: string | null): UseChatSocketResult {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pool, setPoolState] = useState<CrowdfundingPool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roomId) return;
    setMessages([]);
    setPoolState(null);
    setError(null);

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    socketRef.current = ws;

    // Only the socket that is still the active one may touch React state. This
    // guards against StrictMode's double-mount (and route changes), where a
    // socket closed while still CONNECTING fires a late error/close event that
    // would otherwise clobber the state of its successor.
    const isCurrent = () => socketRef.current === ws;

    ws.onopen = () => {
      const token = getToken();
      if (token) ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      if (!isCurrent()) return;
      const frame = JSON.parse(event.data as string) as WsServerFrame;
      switch (frame.type) {
        case 'ready':
          setConnected(true);
          ws.send(JSON.stringify({ type: 'join', roomId }));
          break;
        case 'joined':
          setMessages(frame.messages);
          break;
        case 'message':
          setMessages((prev) => (prev.some((m) => m.id === frame.message.id) ? prev : [...prev, frame.message]));
          break;
        case 'message-updated':
          setMessages((prev) => prev.map((m) => (m.id === frame.message.id ? frame.message : m)));
          break;
        case 'message-deleted':
          setMessages((prev) => prev.filter((m) => m.id !== frame.id));
          break;
        case 'pool':
          setPoolState(frame.pool);
          break;
        case 'error':
          setError(frame.error);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      if (isCurrent()) setConnected(false);
    };
    ws.onerror = () => {
      if (isCurrent()) setError('WebSocket connection error');
    };

    return () => {
      // Detach handlers before closing so a socket aborted mid-handshake can't
      // push a spurious error/close into the state of the next connection.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (socketRef.current === ws) socketRef.current = null;
      ws.close();
      setConnected(false);
    };
  }, [roomId]);

  const send = useCallback(
    (body: string) => {
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && roomId && body.trim()) {
        ws.send(JSON.stringify({ type: 'message', roomId, body: body.trim() }));
      }
    },
    [roomId],
  );

  const setPool = useCallback((next: CrowdfundingPool) => setPoolState(next), []);

  return { connected, messages, pool, error, send, setPool };
}
