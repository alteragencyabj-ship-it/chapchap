import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  StatusBar,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, RADII } from '../src/config/constants';
import api from '../src/services/api';
import { useNotificationStore } from '../src/store/notificationStore';
import { useSyncStore } from '../src/store/syncStore';

interface NotifItem {
  _id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  read: boolean;
  created_at: string;
}

const ICON_MAP: Record<string, { name: string; color: string }> = {
  request_accepted: { name: 'checkmark-circle', color: COLORS.iconSage },
  request_refused: { name: 'close-circle', color: COLORS.iconRose },
  work_started: { name: 'hammer', color: COLORS.iconSteel },
  work_completed: { name: 'checkmark-done', color: COLORS.iconSage },
  request_new: { name: 'add-circle', color: COLORS.iconIce },
  mission_confirmed: { name: 'trophy', color: COLORS.iconSand },
  new_message: { name: 'chatbubble', color: COLORS.iconSteel },
  account_blocked: { name: 'lock-closed', color: COLORS.iconRose },
  credit_low: { name: 'warning', color: COLORS.iconSand },
  dispute_new: { name: 'alert-circle', color: COLORS.iconRose },
};

export default function NotificationCenter() {
  const router = useRouter();
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);
  const clearUnread = useNotificationStore((s) => s.clearUnread);
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications, syncVersion]);

  const markRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)));
      fetchUnreadCount();
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      clearUnread();
    } catch {}
  };

  const handlePress = (item: NotifItem) => {
    if (!item.read) markRead(item._id);
    // Deep link based on data
    if (item.data?.request_id) {
      router.push({ pathname: '/request-details', params: { requestId: item.data.request_id } });
    } else if (item.data?.conversation_id) {
      router.push({ pathname: '/chat', params: { conversationId: item.data.conversation_id } });
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "A l'instant";
    if (mins < 60) return `Il y a ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Il y a ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `Il y a ${days}j`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const renderItem = ({ item }: { item: NotifItem }) => {
    const iconConfig = ICON_MAP[item.type] || { name: 'notifications', color: COLORS.textLight };

    return (
      <TouchableOpacity
        style={[styles.notifItem, !item.read && styles.unread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconCircle, { backgroundColor: `${iconConfig.color}18` }]}>
          <Ionicons name={iconConfig.name as any} size={22} color={iconConfig.color} />
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifHeader}>
            <Text style={[styles.notifTitle, !item.read && styles.notifTitleUnread]} numberOfLines={1}>{item.title}</Text>
            {!item.read && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
          <Text style={styles.notifTime}>{formatTime(item.created_at)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={markAllRead} style={styles.markAllReadButton}>
          <Text style={styles.markAllRead}>Tout lire</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="notifications-off-outline" size={80} color={COLORS.textLight} />
          <Text style={styles.emptyText}>Aucune notification pour le moment</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchNotifications(); }}
              colors={[COLORS.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    minHeight: 56,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: RADII.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
  },
  markAllReadButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  markAllRead: {
    ...TYPOGRAPHY.label,
    color: COLORS.primary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    ...TYPOGRAPHY.h3,
    fontSize: 17,
    color: COLORS.textLight,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: SPACING.lg,
  },
  notifItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  unread: {
    backgroundColor: `${COLORS.primary}08`,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
    marginTop: 2,
  },
  notifContent: {
    flex: 1,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  notifTitle: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    color: COLORS.dark,
    flex: 1,
  },
  notifTitleUnread: {
    fontWeight: '700',
  },
  notifBody: {
    ...TYPOGRAPHY.caption,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.textLight,
    marginBottom: SPACING.xs,
  },
  notifTime: {
    ...TYPOGRAPHY.caption,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.info,
    marginLeft: SPACING.sm,
    flexShrink: 0,
  },
});
