import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, STATUS_COLORS, STATUS_LABELS, SHADOWS, SPACING, TYPOGRAPHY, RADII } from '../src/config/constants';
import api from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { getSocket } from '../src/services/socket';
import { useSyncStore } from '../src/store/syncStore';

const PAGE_SIZE = 40;

interface ChatMessage {
  _id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  message_type: string;
  timestamp: string;
  read: boolean;
  _pending?: boolean;
  _failed?: boolean;
  _clientId?: string;
}

interface ConversationMission {
  request_id: string;
  status: string;
  service_type: string;
  artisan_id?: string;
}

// ---- Animated message wrapper for fade-in entrance ----
const AnimatedMessage = ({ children }: { children: React.ReactNode }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
};

// ---- System message icon/color per type keyword ----
const getSystemMessageStyle = (message: string) => {
  const lower = (message || '').toLowerCase();
  if (lower.includes('annul') || lower.includes('litige') || lower.includes('erreur')) {
    return { icon: 'close-circle' as const, bg: `${COLORS.error}12`, color: COLORS.error };
  }
  if (lower.includes('termin') || lower.includes('valid') || lower.includes('confirm')) {
    return { icon: 'checkmark-circle' as const, bg: `${COLORS.success}15`, color: COLORS.success };
  }
  if (lower.includes('route') || lower.includes('en cours') || lower.includes('accept')) {
    return { icon: 'arrow-forward-circle' as const, bg: `${COLORS.info}12`, color: COLORS.info };
  }
  // Default info style
  return { icon: 'information-circle' as const, bg: `${COLORS.blue}15`, color: COLORS.blue };
};

// Monotonic client-side ID for optimistic messages
let _clientIdCounter = 0;
const nextClientId = () => `_local_${Date.now()}_${++_clientIdCounter}`;

export default function Chat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const user = useAuthStore((state) => state.user);
  const userId = user?._id;
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [mission, setMission] = useState<ConversationMission | null>(null);
  const [missionActionLoading, setMissionActionLoading] = useState(false);
  const [otherPartyName, setOtherPartyName] = useState<string | null>(null);
  const [otherPartyPhone, setOtherPartyPhone] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);

  // Track seen message IDs for deduplication
  const seenIdsRef = useRef(new Set<string>());

  const isArtisan = user?.role === 'artisan';

  // Deduplicate and sort messages helper
  const deduplicateAndSort = useCallback((msgs: ChatMessage[]): ChatMessage[] => {
    const map = new Map<string, ChatMessage>();
    for (const m of msgs) {
      const key = m._id || m._clientId || '';
      if (!key) continue;
      const existing = map.get(key);
      // Prefer server message over local optimistic one
      if (!existing || (existing._pending && !m._pending)) {
        map.set(key, m);
      }
    }
    const result = Array.from(map.values());
    result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return result;
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!conversationId) return;
    setLoadError(false);
    try {
      const res = await api.get(`/conversations/${conversationId}/messages`, {
        params: { limit: PAGE_SIZE },
      });
      const data: ChatMessage[] = Array.isArray(res.data) ? res.data : [];
      setMessages(data);
      setHasOlderMessages(data.length >= PAGE_SIZE);
      // Populate seen IDs
      const seen = seenIdsRef.current;
      seen.clear();
      for (const m of data) {
        if (m._id) seen.add(m._id);
      }
      // Mark as read (fire-and-forget)
      api.post(`/conversations/${conversationId}/read`).catch(() => {});
    } catch (err) {
      console.error('Failed to load messages:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasOlderMessages || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      if (!oldest) return;
      const res = await api.get(`/conversations/${conversationId}/messages`, {
        params: { before: oldest.timestamp || oldest._id, limit: PAGE_SIZE },
      });
      const olderMsgs: ChatMessage[] = Array.isArray(res.data) ? res.data : [];
      if (olderMsgs.length < PAGE_SIZE) {
        setHasOlderMessages(false);
      }
      if (olderMsgs.length > 0) {
        setMessages((prev) => {
          const seen = seenIdsRef.current;
          const newMsgs = olderMsgs.filter((m) => m._id && !seen.has(m._id));
          for (const m of newMsgs) seen.add(m._id);
          return deduplicateAndSort([...newMsgs, ...prev]);
        });
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, hasOlderMessages, messages, deduplicateAndSort]);

  const fetchMission = useCallback(async () => {
    if (!conversationId) return;
    try {
      const convRes = await api.get(`/conversations/${conversationId}`);
      const convData = convRes.data;
      if (!convData) return;
      const requestId = convData.request_id;

      // Extract other party name from conversation participants
      let foundName: string | null = null;
      const participants = convData.participants;
      if (participants && Array.isArray(participants)) {
        const other = participants.find(
          (p: any) => p._id !== userId && p.user_id !== userId,
        );
        if (other) {
          foundName = other.name || other.full_name || other.first_name || null;
        }
      }
      // Also check top-level fields if participants didn't yield a name
      if (!foundName) {
        foundName = convData.other_party_name || convData.other_user_name || null;
      }
      if (foundName) setOtherPartyName(foundName);

      if (requestId) {
        const [reqRes, actionsRes] = await Promise.all([
          api.get(`/requests/${requestId}`).catch(() => null),
          api.get(`/requests/${requestId}/available-actions`).catch(() => null),
        ]);
        if (reqRes?.data) {
          setMission({
            request_id: requestId,
            status: reqRes.data.status,
            service_type: reqRes.data.service_name || reqRes.data.service_type || '',
            artisan_id: reqRes.data.assigned_artisan_id || reqRes.data.artisan_id,
          });
        }

        const contact = actionsRes?.data?.contact || {};
        const contactName = isArtisan ? contact.client_name : contact.artisan_name;
        const contactPhone = isArtisan ? contact.client_phone : contact.artisan_phone;
        if (contactName) setOtherPartyName(contactName);
        setOtherPartyPhone(contactPhone || null);
      }
    } catch {
      // Silent - conversation may not have a linked request
      setOtherPartyPhone(null);
    }
  }, [conversationId, isArtisan, userId]);

  useEffect(() => {
    fetchMessages();
    fetchMission();
  }, [fetchMessages, fetchMission]);

  useEffect(() => {
    if (!conversationId) return;
    fetchMission();
  }, [conversationId, fetchMission, syncVersion]);

  // Listen for real-time messages
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !conversationId) return;

    const handler = (msg: any) => {
      if (!msg || msg.conversation_id !== conversationId) return;
      const msgId = msg._id;
      if (!msgId) return;

      setMessages((prev) => {
        if (seenIdsRef.current.has(msgId)) return prev;
        seenIdsRef.current.add(msgId);
        return deduplicateAndSort([...prev, msg]);
      });

      // Mark as read since user is viewing this conversation
      api.post(`/conversations/${conversationId}/read`).catch(() => {});
    };

    socket.on('receive_message', handler);
    return () => {
      socket.off('receive_message', handler);
    };
  }, [conversationId, deduplicateAndSort]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !conversationId || !userId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const clientId = nextClientId();

    // Optimistic insert -- message appears instantly
    const optimisticMsg: ChatMessage = {
      _id: clientId,
      _clientId: clientId,
      sender_id: userId,
      receiver_id: '',
      message: text,
      message_type: 'user',
      timestamp: new Date().toISOString(),
      read: false,
      _pending: true,
    };

    setMessages((prev) => deduplicateAndSort([...prev, optimisticMsg]));
    setInput('');
    setSending(true);

    try {
      const res = await api.post(`/conversations/${conversationId}/messages`, {
        message: text,
      });
      const serverMsg: ChatMessage = res.data;
      if (serverMsg?._id) {
        seenIdsRef.current.add(serverMsg._id);
      }
      // Replace optimistic message with server response
      setMessages((prev) => {
        const filtered = prev.filter((m) => m._id !== clientId);
        return deduplicateAndSort([...filtered, serverMsg]);
      });
    } catch (err: any) {
      console.error('Failed to send message:', err);
      // Mark optimistic message as failed with retry option
      setMessages((prev) =>
        prev.map((m) =>
          m._id === clientId ? { ...m, _pending: false, _failed: true } : m,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const retryMessage = async (failedMsg: ChatMessage) => {
    if (!conversationId) return;
    const text = failedMsg.message;
    const failedId = failedMsg._id;

    // Mark as pending again
    setMessages((prev) =>
      prev.map((m) =>
        m._id === failedId ? { ...m, _pending: true, _failed: false } : m,
      ),
    );

    try {
      const res = await api.post(`/conversations/${conversationId}/messages`, {
        message: text,
      });
      const serverMsg: ChatMessage = res.data;
      if (serverMsg?._id) {
        seenIdsRef.current.add(serverMsg._id);
      }
      setMessages((prev) => {
        const filtered = prev.filter((m) => m._id !== failedId);
        return deduplicateAndSort([...filtered, serverMsg]);
      });
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === failedId ? { ...m, _pending: false, _failed: true } : m,
        ),
      );
    }
  };

  const handleCall = async () => {
    if (!otherPartyPhone) return;
    try {
      await Linking.openURL(`tel:${otherPartyPhone}`);
    } catch {
      Alert.alert('Erreur', "Impossible de lancer l'appel pour le moment.");
    }
  };

  const handleMissionAction = async (endpoint: string, confirmMsg?: string) => {
    if (!mission) return;

    // Some endpoints require a specific body
    const bodyMap: Record<string, any> = {
      confirm: { warning_ack: true },
      dispute: {
        reason: isArtisan ? 'Probleme signale par l artisan' : 'Probleme signale par le client',
        category: 'qualite_service',
      },
    };

    const doIt = async () => {
      setMissionActionLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await api.post(
          `/requests/${mission.request_id}/${endpoint}`,
          bodyMap[endpoint] || {},
        );
        await fetchMission();
        await fetchMessages(); // Refresh to show system message

        if (endpoint === 'confirm' && !isArtisan && mission.artisan_id) {
          router.push({
            pathname: '/rate-mission',
            params: {
              requestId: mission.request_id,
              artisanId: mission.artisan_id,
              serviceName: mission.service_type,
            },
          });
        }

        if (endpoint === 'dispute') {
          router.push({
            pathname: '/support',
            params: {
              requestId: mission.request_id,
              from: 'chat',
            },
          });
        }
      } catch (error: any) {
        const detail = error?.response?.data?.detail || "Une erreur s'est produite.";
        Alert.alert('Erreur', detail);
      } finally {
        setMissionActionLoading(false);
      }
    };

    if (confirmMsg) {
      Alert.alert('Confirmation', confirmMsg, [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: doIt },
      ]);
    } else {
      await doIt();
    }
  };

  // Helper: format date as day separator label
  const formatDaySeparator = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Reversed data for inverted FlatList (newest first)
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // Check if we need a day separator AFTER a message in inverted list
  // In inverted list, index 0 = newest. Separator appears below (visually above) when next item has different day.
  const shouldShowDaySeparator = (index: number) => {
    if (index === invertedMessages.length - 1) return true;
    const curr = new Date(invertedMessages[index].timestamp);
    const next = new Date(invertedMessages[index + 1].timestamp);
    return curr.toDateString() !== next.toDateString();
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.sender_id === (user as any)?._id;
    const isSystem = item.message_type === 'system';
    const showDaySeparator = shouldShowDaySeparator(index);
    const systemStyle = isSystem ? getSystemMessageStyle(item.message) : null;

    const timeStr = new Date(item.timestamp).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <AnimatedMessage>
        {isSystem ? (
          <View style={[styles.systemMessage, { backgroundColor: systemStyle!.bg }]}>
            <Ionicons
              name={systemStyle!.icon}
              size={15}
              color={systemStyle!.color}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.systemText, { color: systemStyle!.color }]}>{item.message}</Text>
          </View>
        ) : (
          <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.otherMessage]}>
            <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.otherMessageText]}>
              {item.message}
            </Text>
            <View style={styles.messageFooter}>
              <Text style={[styles.messageTime, isMe ? styles.myTime : styles.otherTime]}>
                {timeStr}
              </Text>
              {isMe && (
                <Ionicons
                  name={item.read ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={item.read ? '#34C759' : 'rgba(255,255,255,0.5)'}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          </View>
        )}
        {showDaySeparator && (
          <View style={styles.daySeparator}>
            <View style={styles.daySeparatorLine} />
            <Text style={styles.daySeparatorText}>{formatDaySeparator(item.timestamp)}</Text>
            <View style={styles.daySeparatorLine} />
          </View>
        )}
      </AnimatedMessage>
    );
  };

  // Determine mission banner action
  const renderMissionBanner = () => {
    if (!mission) return null;

    const statusColor = STATUS_COLORS[mission.status] || COLORS.textLight;
    const statusLabel = STATUS_LABELS[mission.status] || mission.status;

    let actionButton: React.ReactNode = null;
    const canDispute = ['artisan_en_route', 'mission_en_cours', 'terminee'].includes(mission.status);

    if (isArtisan) {
      if (mission.status === 'acceptee') {
        actionButton = (
          <TouchableOpacity
            style={[styles.bannerAction, { backgroundColor: COLORS.info }]}
            onPress={() => handleMissionAction('en-route')}
            disabled={missionActionLoading}
          >
            {missionActionLoading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="navigate" size={16} color="#FFF" />
                <Text style={styles.bannerActionText}>En route</Text>
              </>
            )}
          </TouchableOpacity>
        );
      } else if (mission.status === 'artisan_en_route' || mission.status === 'mission_en_cours') {
        actionButton = (
          <TouchableOpacity
            style={[styles.bannerAction, { backgroundColor: COLORS.success }]}
            onPress={() => handleMissionAction('complete', 'Confirmer que la mission est terminee ?')}
            disabled={missionActionLoading}
          >
            {missionActionLoading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-done" size={16} color="#FFF" />
                <Text style={styles.bannerActionText}>Mission terminee</Text>
              </>
            )}
          </TouchableOpacity>
        );
      }
    }

    if (!isArtisan && mission.status === 'terminee') {
      actionButton = (
        <View style={styles.bannerActionsRow}>
          <TouchableOpacity
            style={[styles.bannerAction, { backgroundColor: COLORS.success }]}
            onPress={() => handleMissionAction('confirm', 'Valider la mission ? Les fonds seront liberes.')}
            disabled={missionActionLoading}
          >
            {missionActionLoading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={16} color="#FFF" />
                <Text style={styles.bannerActionText}>Valider</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bannerAction, styles.bannerActionAlt]}
            onPress={() =>
              handleMissionAction(
                'dispute',
                'Un probleme ? Ouvrir un litige et contacter le support ?',
              )
            }
            disabled={missionActionLoading}
          >
            <Ionicons name="warning" size={16} color="#FF9F0A" />
            <Text style={[styles.bannerActionText, { color: '#FF9F0A' }]}>Probleme</Text>
          </TouchableOpacity>
        </View>
      );
    } else if (mission.status === 'litige') {
      actionButton = (
        <TouchableOpacity
          style={[styles.bannerAction, styles.bannerActionAlt]}
          onPress={() =>
            router.push({
              pathname: '/support',
              params: { requestId: mission.request_id, from: 'chat' },
            })
          }
        >
          <Ionicons name="headset" size={16} color="#FF9F0A" />
          <Text style={[styles.bannerActionText, { color: '#FF9F0A' }]}>Support</Text>
        </TouchableOpacity>
      );
    } else if (canDispute) {
      const disputeButton = (
        <TouchableOpacity
          style={[styles.bannerAction, styles.bannerActionAlt]}
          onPress={() =>
            handleMissionAction(
              'dispute',
              'Confirmer l ouverture du litige ?',
            )
          }
          disabled={missionActionLoading}
        >
          <Ionicons name="warning" size={16} color="#FF9F0A" />
          <Text style={[styles.bannerActionText, { color: '#FF9F0A' }]}>Litige</Text>
        </TouchableOpacity>
      );

      actionButton = actionButton ? <View style={styles.bannerActionsRow}>{actionButton}{disputeButton}</View> : disputeButton;
    }

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push({ pathname: '/request-details', params: { requestId: mission.request_id } })}
      >
        <LinearGradient
          colors={[COLORS.white, COLORS.neutral50]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.missionBanner}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerService} numberOfLines={1}>
              {mission.service_type}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <View style={[styles.bannerDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.bannerStatus, { color: statusColor }]}>
                {statusLabel}
              </Text>
            </View>
          </View>
          {actionButton}
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.neutral400}
            style={{ marginLeft: actionButton ? 8 : 0 }}
          />
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  // Header status dot color based on mission
  const headerStatusColor = mission ? (STATUS_COLORS[mission.status] || COLORS.textLight) : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {otherPartyName || 'Chat'}
          </Text>
          {headerStatusColor && (
            <View style={[styles.headerStatusDot, { backgroundColor: headerStatusColor }]} />
          )}
        </View>
      </View>

      {otherPartyPhone ? (
        <TouchableOpacity style={styles.phoneStrip} onPress={handleCall} activeOpacity={0.8}>
          <Ionicons name="call-outline" size={16} color={COLORS.success} />
          <Text style={styles.phoneStripText}>{otherPartyPhone}</Text>
        </TouchableOpacity>
      ) : null}

      {renderMissionBanner()}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={invertedMessages}
            inverted
            keyExtractor={(item) => item._id}
            renderItem={renderMessage}
            contentContainerStyle={[styles.messagesList, invertedMessages.length === 0 && styles.messagesListEmpty]}
            ListEmptyComponent={
              <View style={styles.emptyChatContainer}>
                <View style={styles.emptyIconWrapper}>
                  <Ionicons name="chatbubbles-outline" size={80} color={COLORS.neutral300} />
                </View>
                <Text style={styles.emptyChatTitle}>Demarrez la conversation</Text>
                <Text style={styles.emptyChatText}>
                  Envoyez un message pour echanger les details de votre{' '}
                  {isArtisan ? 'mission' : 'demande'} et coordonner les prochaines etapes.
                </Text>
              </View>
            }
          />
        )}

        <View style={[styles.inputContainer, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity
            style={styles.attachButton}
            activeOpacity={0.75}
            onPress={() => Alert.alert('Bientot disponible', "L'envoi de photo sera active dans une prochaine mise a jour.")}
          >
            <Ionicons name="camera-outline" size={22} color={COLORS.neutral500} />
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Votre message..."
            placeholderTextColor={COLORS.textLight}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!input.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="send" size={18} color={COLORS.white} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  // ── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.white,
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
    marginRight: SPACING.sm,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: SPACING.sm,
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
    flexShrink: 1,
  },
  headerStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  phoneStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    backgroundColor: `${COLORS.success}12`,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  phoneStripText: {
    color: COLORS.success,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  // ── Mission banner ──────────────────────────────────────────────────
  missionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  bannerService: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    color: COLORS.dark,
    textTransform: 'capitalize',
  },
  bannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bannerStatus: {
    ...TYPOGRAPHY.label,
  },
  bannerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    gap: 6,
  },
  bannerActionText: {
    ...TYPOGRAPHY.label,
    color: COLORS.white,
  },
  bannerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  bannerActionAlt: {
    backgroundColor: '#FF9F0A14',
    borderWidth: 1,
    borderColor: '#FF9F0A40',
  },
  // ── Loading ─────────────────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // ── Messages list ───────────────────────────────────────────────────
  messagesList: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  messagesListEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  messageBubble: {
    maxWidth: '78%',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: 6,
    borderRadius: RADII.lg,
    marginBottom: SPACING.xs,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: SPACING.xs,
    ...SHADOWS.sm,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.white,
    borderBottomLeftRadius: SPACING.xs,
    ...SHADOWS.sm,
  },
  messageText: {
    ...TYPOGRAPHY.body,
  },
  myMessageText: {
    color: COLORS.white,
  },
  otherMessageText: {
    color: COLORS.dark,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  messageTime: {
    ...TYPOGRAPHY.caption,
    fontSize: 11,
    lineHeight: 14,
  },
  myTime: {
    color: 'rgba(255,255,255,0.65)',
  },
  otherTime: {
    color: COLORS.textLight,
  },
  // ── System messages ─────────────────────────────────────────────────
  systemMessage: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: RADII.md,
    marginVertical: SPACING.xs,
    maxWidth: '90%',
  },
  systemText: {
    ...TYPOGRAPHY.caption,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
    flexShrink: 1,
  },
  // ── Input area ──────────────────────────────────────────────────────
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: RADII.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.xs,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.light,
    borderRadius: RADII.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 100,
    color: COLORS.dark,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: SPACING.sm,
    marginBottom: 2,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  // ── Day separator ───────────────────────────────────────────────────
  daySeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
    paddingHorizontal: SPACING.sm,
  },
  daySeparatorLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.neutral300,
  },
  daySeparatorText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    paddingHorizontal: SPACING.md,
  },
  // ── Empty state ─────────────────────────────────────────────────────
  emptyChatContainer: {
    alignItems: 'center',
    paddingHorizontal: 40,
    transform: [{ scaleY: -1 }],
  },
  emptyIconWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.neutral100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  emptyChatTitle: {
    ...TYPOGRAPHY.h2,
    fontSize: 20,
    marginBottom: SPACING.sm,
  },
  emptyChatText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});
