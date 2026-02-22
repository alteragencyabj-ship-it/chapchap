import { create } from 'zustand';
import api from '../services/api';

interface NotificationStore {
  unreadCount: number;
  isLoading: boolean;
  fetchUnreadCount: () => Promise<void>;
  incrementUnread: () => void;
  decrementUnread: () => void;
  clearUnread: () => void;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  unreadCount: 0,
  isLoading: false,

  fetchUnreadCount: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const res = await api.get('/notifications/unread-count');
      const raw = res.data || {};
      const unread =
        raw.unread ??
        raw.unread_count ??
        raw.count ??
        0;
      set({ unreadCount: Math.max(0, Number(unread) || 0), isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  incrementUnread: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),

  decrementUnread: () => set((state) => ({
    unreadCount: Math.max(0, state.unreadCount - 1),
  })),

  clearUnread: () => set({ unreadCount: 0 }),

  markAllRead: async () => {
    try {
      await api.post('/notifications/mark-all-read');
      set({ unreadCount: 0 });
    } catch {
      // Silent fail — badge may be out of sync until next fetch
    }
  },
}));
