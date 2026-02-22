import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useAuthStore } from '../src/store/authStore';
import { useMissionStore } from '../src/store/missionStore';
import { useNotificationStore } from '../src/store/notificationStore';
import { useSyncStore } from '../src/store/syncStore';
import { connectSocket, disconnectSocket, getSocket } from '../src/services/socket';

export default function RootLayout() {
  const initialize = useAuthStore((state) => state.initialize);
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const refreshMe = useAuthStore((state) => state.refreshMe);
  const fetchMissionCount = useMissionStore((state) => state.fetchCount);
  const fetchUnreadCount = useNotificationStore((state) => state.fetchUnreadCount);
  const incrementUnread = useNotificationStore((state) => state.incrementUnread);
  const bumpSync = useSyncStore((state) => state.bumpSync);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Connect socket when authenticated
  useEffect(() => {
    if (user && token) {
      connectSocket((user as any)._id, token);
      const socket = getSocket();
      const onMissionUpdate = (payload: any) => {
        bumpSync('mission_update', payload || null);
        fetchMissionCount();
        fetchUnreadCount();
        refreshMe();
      };
      const onWalletUpdate = (payload: any) => {
        bumpSync('wallet_update', payload || null);
        fetchMissionCount();
        refreshMe();
      };
      const onNotification = (payload: any) => {
        incrementUnread();
        bumpSync('notification', payload || null);
      };
      const onReceiveMessage = (payload: any) => {
        bumpSync('receive_message', payload || null);
        fetchUnreadCount();
      };

      socket?.on('mission_update', onMissionUpdate);
      socket?.on('wallet_update', onWalletUpdate);
      socket?.on('notification', onNotification);
      socket?.on('receive_message', onReceiveMessage);

      return () => {
        socket?.off('mission_update', onMissionUpdate);
        socket?.off('wallet_update', onWalletUpdate);
        socket?.off('notification', onNotification);
        socket?.off('receive_message', onReceiveMessage);
        disconnectSocket();
      };
    }
    return () => {
      disconnectSocket();
    };
  }, [
    user,
    token,
    bumpSync,
    fetchMissionCount,
    fetchUnreadCount,
    incrementUnread,
    refreshMe,
  ]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
