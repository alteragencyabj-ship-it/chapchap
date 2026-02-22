import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';

export interface User {
  _id: string;
  name: string;
  email: string;
  phone: string;
  role: 'client' | 'artisan' | 'admin';
  photo?: string;
  address?: string;
  quartier?: string;
  city?: string;
  specialties?: string[];
  specialty_domains?: string[];
  verified?: boolean;
  average_rating?: number;
  total_missions?: number;
  referral_id?: string;
  referred_by_artisan_id?: string;
  affiliated_clients_count?: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadPart = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadPart + '='.repeat((4 - (payloadPart.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function isExpired(token: string): boolean {
  const exp = parseJwtExp(token);
  if (!exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return exp <= nowSec;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  setUser: (user) => {
    set({ user });
    // Persist user data to AsyncStorage so it survives app restarts
    if (user) {
      AsyncStorage.setItem('user_data', JSON.stringify(user)).catch(() => {});
    } else {
      AsyncStorage.removeItem('user_data').catch(() => {});
    }
  },

  setToken: async (token) => {
    if (token) {
      await AsyncStorage.setItem('auth_token', token);
    } else {
      await AsyncStorage.removeItem('auth_token');
    }
    set({ token });
  },

  logout: async () => {
    // Clear persisted data
    await AsyncStorage.multiRemove(['auth_token', 'user_data']).catch(() => {});

    // Reset auth state
    set({ user: null, token: null });

    // Disconnect socket (dynamic import to avoid circular deps)
    try {
      const { disconnectSocket } = await import('../services/socket');
      disconnectSocket();
    } catch {
      // Socket module may not be loaded yet
    }
  },

  initialize: async () => {
    try {
      const [token, userData] = await AsyncStorage.multiGet(['auth_token', 'user_data']);
      const storedToken = token[1];
      const storedUser = userData[1];

      if (storedToken && storedUser) {
        if (isExpired(storedToken)) {
          await AsyncStorage.multiRemove(['auth_token', 'user_data']);
          set({ user: null, token: null, isLoading: false });
          return;
        }
        try {
          const parsedUser = JSON.parse(storedUser);
          set({ token: storedToken, user: parsedUser, isLoading: false });
        } catch {
          // Corrupted user data — clear everything
          await AsyncStorage.multiRemove(['auth_token', 'user_data']);
          set({ user: null, token: null, isLoading: false });
        }
      } else if (storedToken && !storedUser) {
        // Token exists but no user data — token alone is usable,
        // refreshMe will fetch the user profile
        if (isExpired(storedToken)) {
          await AsyncStorage.removeItem('auth_token');
          set({ user: null, token: null, isLoading: false });
        } else {
          set({ token: storedToken, user: null, isLoading: false });
        }
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('[Auth] Failed to initialize:', error);
      set({ isLoading: false });
    }
  },

  refreshMe: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    try {
      const { default: api } = await import('../services/api');
      const res = await api.get('/auth/me');
      const freshUser = res.data;
      if (freshUser && freshUser._id) {
        set({ user: freshUser });
        await AsyncStorage.setItem('user_data', JSON.stringify(freshUser));
      }
    } catch {
      // Keep existing local user if refresh fails.
    }
  },
}));
