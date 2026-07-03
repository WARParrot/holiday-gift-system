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

    ws.onopen = () => {
      const token = getToken();
      if (token) ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
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

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError('WebSocket connection error');

    return () => {
      ws.close();
      socketRef.current = null;
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
