import { create } from 'zustand';
import { api } from '../api/client';
import type { AppNotification } from '../types/domain';

interface NotificationState {
  items: AppNotification[];
  unread: number;
  refresh: () => Promise<void>;
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
