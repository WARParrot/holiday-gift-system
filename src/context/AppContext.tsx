/**
 * Global application state.
 *
 * In this barebones version everything lives in React state seeded from mock
 * data. Swap the internals for API/WebSocket calls without changing the
 * component-facing hook (`useApp`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  CHAT_MESSAGES,
  CURRENT_USER_ID,
  GROUPS,
  USERS,
} from '../data/mockData';
import type {
  AppNotification,
  ChatMessage,
  Group,
  ID,
  Subscription,
  User,
} from '../types';

interface AppState {
  currentUser: User;
  users: User[];
  groups: Group[];
  subscriptions: Subscription[];
  notifications: AppNotification[];

  isSubscribed: (type: Subscription['type'], targetId: ID) => boolean;
  toggleSubscription: (type: Subscription['type'], targetId: ID) => void;

  getChatMessages: (friendCardUserId: ID) => ChatMessage[];
  sendChatMessage: (friendCardUserId: ID, text: string) => void;

  markNotificationsRead: () => void;
}

const AppContext = createContext<AppState | null>(null);

let idCounter = 0;
const nextId = (prefix: string): ID => `${prefix}-${Date.now()}-${idCounter++}`;

export function AppProvider({ children }: { children: ReactNode }) {
  const [users] = useState<User[]>(USERS);
  const [groups] = useState<Group[]>(GROUPS);
  const [messages, setMessages] = useState<ChatMessage[]>(CHAT_MESSAGES);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const currentUser = useMemo(
    () => users.find((u) => u.id === CURRENT_USER_ID)!,
    [users],
  );

  const isSubscribed = useCallback(
    (type: Subscription['type'], targetId: ID) =>
      subscriptions.some((s) => s.type === type && s.targetId === targetId),
    [subscriptions],
  );

  const toggleSubscription = useCallback(
    (type: Subscription['type'], targetId: ID) => {
      setSubscriptions((prev) => {
        const exists = prev.some(
          (s) => s.type === type && s.targetId === targetId,
        );
        return exists
          ? prev.filter((s) => !(s.type === type && s.targetId === targetId))
          : [...prev, { type, targetId }];
      });

      // Simulate the notification a subscription would generate.
      if (!isSubscribed(type, targetId)) {
        setNotifications((prev) => [
          {
            id: nextId('n'),
            message: `Subscribed to reminders for this ${type}.`,
            createdAt: new Date().toISOString(),
            read: false,
          },
          ...prev,
        ]);
      }
    },
    [isSubscribed],
  );

  const getChatMessages = useCallback(
    (friendCardUserId: ID) =>
      messages
        .filter((m) => m.friendCardUserId === friendCardUserId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages],
  );

  const sendChatMessage = useCallback(
    (friendCardUserId: ID, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId('m'),
          friendCardUserId,
          authorId: currentUser.id,
          text: trimmed,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    [currentUser.id],
  );

  const markNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const value = useMemo<AppState>(
    () => ({
      currentUser,
      users,
      groups,
      subscriptions,
      notifications,
      isSubscribed,
      toggleSubscription,
      getChatMessages,
      sendChatMessage,
      markNotificationsRead,
    }),
    [
      currentUser,
      users,
      groups,
      subscriptions,
      notifications,
      isSubscribed,
      toggleSubscription,
      getChatMessages,
      sendChatMessage,
      markNotificationsRead,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}
