import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import api from './api';

// Configure notification handler (foreground display)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Register push token with backend after login.
 * Handles permission request, Android channel creation, and token registration.
 */
export async function registerPushToken(): Promise<string | null> {
  try {
    // Android requires a notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0A84FF',
        sound: 'default',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission not granted');
      return null;
    }

    const projectId =
      process.env.EXPO_PUBLIC_EXPO_PROJECT_ID ||
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn('[Notifications] No projectId found — push tokens may not work in production');
    }

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Send to backend with platform info
    await api.post('/notifications/register-token', {
      token,
      platform: Platform.OS,
    });
    console.log('[Notifications] Push token registered:', token);
    return token;
  } catch (error) {
    console.error('[Notifications] Failed to register push token:', error);
    return null;
  }
}

/**
 * Set up notification listeners (foreground + background tap).
 * Returns a cleanup function that removes both subscriptions.
 */
export function setupNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationTapped?: (response: Notifications.NotificationResponse) => void,
) {
  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    onNotificationReceived?.(notification);
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    onNotificationTapped?.(response);
  });

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}
