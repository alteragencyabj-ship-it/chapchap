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
import { COLORS, SPACING, TYPOGRAPHY } from '../../src/config/constants';
import api from '../../src/services/api';
import { useSyncStore } from '../../src/store/syncStore';
import { useAuthStore } from '../../src/store/authStore';

interface Conversation {
  _id: string;
  request_id: string;
  participants: string[];
  last_message: string | null;
  last_message_at: string | null;
  unread_count: Record<string, number>;
  other_party_id?: string | null;
  other_party_name?: string | null;
  other_party_role?: string | null;
}

export default function Messages() {
  const router = useRouter();
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const currentUserId = useAuthStore((s) => (s.user as any)?._id as string | undefined);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/conversations');
      setConversations(res.data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations, syncVersion]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchConversations();
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 604800000) {
      return d.toLocaleDateString('fr-FR', { weekday: 'short' });
    }
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const renderItem = ({ item }: { item: Conversation }) => {
    const unreadCount = currentUserId ? (item.unread_count?.[currentUserId] || 0) : 0;
    const hasUnread = unreadCount > 0;

    return (
      <TouchableOpacity
        style={styles.conversationItem}
        onPress={() =>
          router.push({
            pathname: '/chat',
            params: { conversationId: item._id, requestId: item.request_id },
          })
        }
        activeOpacity={0.7}
      >
        <View style={styles.avatar}>
          <Ionicons name="person" size={22} color={COLORS.white} />
        </View>
        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <Text style={[styles.conversationName, hasUnread && styles.conversationNameUnread]} numberOfLines={1}>
              {item.other_party_name || 'Conversation'}
            </Text>
            <View style={styles.rightMeta}>
              <Text style={[styles.conversationTime, hasUnread && styles.conversationTimeUnread]}>
                {formatTime(item.last_message_at)}
              </Text>
            </View>
          </View>
          <View style={styles.lastMessageRow}>
            <Text style={[styles.lastMessage, hasUnread && styles.lastMessageUnread]} numberOfLines={1}>
              {item.last_message || 'Nouvelle conversation'}
            </Text>
            {hasUnread ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {unreadCount > 9 ? '9+' : String(unreadCount)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      {conversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="chatbubbles-outline" size={80} color={COLORS.textLight} />
          <Text style={styles.emptyText}>Pas encore de conversations</Text>
          <Text style={styles.emptySubtext}>
            Faites votre premiere demande ! Vos echanges avec les artisans apparaitront ici.
          </Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item._id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
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
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    ...TYPOGRAPHY.h1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    ...TYPOGRAPHY.h2,
    fontSize: 20,
    marginTop: SPACING.lg,
  },
  emptySubtext: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  conversationName: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    color: COLORS.dark,
    flex: 1,
    marginRight: SPACING.sm,
  },
  conversationNameUnread: {
    fontWeight: '700',
  },
  conversationTime: {
    ...TYPOGRAPHY.caption,
  },
  conversationTimeUnread: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  rightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lastMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastMessage: {
    ...TYPOGRAPHY.body,
    fontSize: 14,
    lineHeight: 18,
    color: COLORS.textLight,
    flex: 1,
    marginRight: SPACING.sm,
  },
  lastMessageUnread: {
    color: COLORS.dark,
    fontWeight: '500',
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.error,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
