import { create } from 'zustand';
import api from '../services/api';

interface MissionStore {
  newMissionCount: number;
  isLoading: boolean;
  lastFetchedAt: number | null;
  fetchCount: () => Promise<void>;
  resetCount: () => void;
}

// Prevent fetching more than once every 10 seconds
const FETCH_THROTTLE_MS = 10_000;

export const useMissionStore = create<MissionStore>((set, get) => ({
  newMissionCount: 0,
  isLoading: false,
  lastFetchedAt: null,

  fetchCount: async () => {
    const { isLoading, lastFetchedAt } = get();

    // Throttle: skip if already loading or fetched recently
    if (isLoading) return;
    if (lastFetchedAt && Date.now() - lastFetchedAt < FETCH_THROTTLE_MS) return;

    set({ isLoading: true });
    try {
      const res = await api.get('/requests/count', {
        params: { status: 'demande_envoyee' },
      });
      set({
        newMissionCount: res.data?.count ?? 0,
        lastFetchedAt: Date.now(),
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  resetCount: () => set({ newMissionCount: 0 }),
}));
