import { create } from 'zustand';
import { api } from '../api/client';
import type { AppNotification } from '../types/domain';

interface NotificationState {
  items: AppNotification[];
  unread: number;
  refresh: () => Promise<void>;
  applyPush: (n: AppNotification) => void;
  removeNotification: (id: string) => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotifications = create<NotificationState>((set) => ({
  items: [],
  unread: 0,

  refresh: async () => {
    const { notifications, unread } = await api.notifications();
    set({ items: notifications, unread });
  },

  // Fold a live push into the list: upsert by id (the server reuses the same id
  // when it bumps a collapsed chat-counter notification) and move it to the top.
  applyPush: (n) =>
    set((state) => {
      const items = [n, ...state.items.filter((x) => x.id !== n.id)];
      return { items, unread: items.filter((x) => !x.read).length };
    }),

  // Drop a notification the server has cleared (e.g. after the user posts in
  // that chat), recomputing the unread badge.
  removeNotification: (id) =>
    set((state) => {
      const items = state.items.filter((x) => x.id !== id);
      return { items, unread: items.filter((x) => !x.read).length };
    }),

  markRead: async (id) => {
    await api.markNotificationRead(id);
    set((state) => {
      const items = state.items.map((n) => (n.id === id ? { ...n, read: true } : n));
      return { items, unread: items.filter((n) => !n.read).length };
    });
  },

  markAllRead: async () => {
    await api.markAllRead();
    set((state) => ({ items: state.items.map((n) => ({ ...n, read: true })), unread: 0 }));
  },
}));
