import { create } from 'zustand';
import api from '../services/api';

interface NotificationStore {
  unreadCount: number;
  fetchUnreadCount: () => Promise<void>;
  incrementUnread: () => void;
  clearUnread: () => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  unreadCount: 0,

  fetchUnreadCount: async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      set({ unreadCount: res.data.unread });
    } catch {
      // Silent fail
    }
  },

  incrementUnread: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),

  clearUnread: () => set({ unreadCount: 0 }),
}));
