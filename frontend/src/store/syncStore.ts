import { create } from 'zustand';

interface SyncState {
  syncVersion: number;
  lastEvent: string | null;
  lastPayload: Record<string, any> | null;
  lastSyncAt: number | null;
  bumpSync: (event: string, payload?: Record<string, any>) => void;
  reset: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  syncVersion: 0,
  lastEvent: null,
  lastPayload: null,
  lastSyncAt: null,

  bumpSync: (event, payload) =>
    set((state) => ({
      syncVersion: state.syncVersion + 1,
      lastEvent: event,
      lastPayload: payload || null,
      lastSyncAt: Date.now(),
    })),

  reset: () =>
    set({
      syncVersion: 0,
      lastEvent: null,
      lastPayload: null,
      lastSyncAt: null,
    }),
}));
