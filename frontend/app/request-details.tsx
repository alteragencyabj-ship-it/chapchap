import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  StatusBar,
  Alert,
  Linking,
  Animated,
  RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import api from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { useSyncStore } from '../src/store/syncStore';
import { COLORS, STATUS_COLORS, STATUS_LABELS, SHADOWS, RADII, SPACING } from '../src/config/constants';
import { format, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

/** Safely format a date string, returning a fallback on invalid input. */
function safeFormatDate(dateStr: string | undefined | null, fmt: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isValid(d)) return '';
    return format(d, fmt, { locale: fr });
  } catch {
    return '';
  }
}

interface RequestDetailsData {
  _id: string;
  service_type: string;
  service_name?: string;
  description: string;
  photos: string[];
  address: string;
  status: string;
  created_at: string;
  budget?: number;
  client_id: string;
  assigned_artisan_id?: string;
  artisan_id?: string;
}

interface AvailableActions {
  actions: string[];
  conversation_id: string | null;
  contact: {
    artisan_phone?: string;
    artisan_name?: string;
    client_phone?: string;
    client_name?: string;
  };
}

// --- Status progress bar steps ---
const LIFECYCLE_STEPS = [
  { key: 'demande_envoyee', label: 'Demande' },
  { key: 'acceptee', label: 'Acceptee' },
  { key: 'artisan_en_route', label: 'En route' },
  { key: 'mission_en_cours', label: 'En cours' },
  { key: 'terminee', label: 'Terminee' },
  { key: 'validee_client', label: 'Validee' },
];

const TERMINAL_STATUSES = ['annulee', 'expiree', 'litige'];

function getStepIndex(status: string): number {
  const idx = LIFECYCLE_STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : -1;
}

// --- Skeleton shimmer placeholder ---
function SkeletonLoader() {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  const Bar = ({ width, height = 14, mb = 12 }: { width: number | string; height?: number; mb?: number }) => (
    <Animated.View
      style={{
        width: width as any,
        height,
        borderRadius: RADII.sm,
        backgroundColor: COLORS.neutral300,
        opacity,
        marginBottom: mb,
      }}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={styles.header}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.neutral200 }} />
        <Bar width={140} height={18} mb={0} />
        <View style={{ width: 24 }} />
      </View>
      <View style={{ padding: SPACING.xl }}>
        {/* Status bar skeleton */}
        <Bar width="100%" height={40} mb={24} />
        {/* Badge */}
        <Bar width={120} height={28} mb={20} />
        {/* Title */}
        <Bar width="70%" height={24} mb={8} />
        <Bar width="40%" height={14} mb={28} />
        {/* Card 1 */}
        <View style={[styles.card, { padding: SPACING.lg }]}>
          <Bar width={90} height={14} mb={12} />
          <Bar width="100%" height={14} mb={8} />
          <Bar width="80%" height={14} mb={0} />
        </View>
        {/* Card 2 */}
        <View style={[styles.card, { padding: SPACING.lg, marginTop: SPACING.lg }]}>
          <Bar width={100} height={14} mb={12} />
          <Bar width="60%" height={14} mb={0} />
        </View>
        {/* Card 3 */}
        <View style={[styles.card, { padding: SPACING.lg, marginTop: SPACING.lg }]}>
          <Bar width={70} height={14} mb={12} />
          <Bar width="50%" height={24} mb={0} />
        </View>
      </View>
    </SafeAreaView>
  );
}

// --- Status progress bar component ---
function StatusProgressBar({ currentStatus }: { currentStatus: string }) {
  const isTerminal = TERMINAL_STATUSES.includes(currentStatus);
  const currentIdx = getStepIndex(currentStatus);

  if (isTerminal) {
    const color = STATUS_COLORS[currentStatus] || COLORS.textLight;
    const label = STATUS_LABELS[currentStatus] || currentStatus;
    return (
      <View style={[styles.progressContainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <View style={[styles.terminalBadge, { backgroundColor: color + '18' }]}>
          <Ionicons
            name={currentStatus === 'annulee' ? 'close-circle' : currentStatus === 'litige' ? 'warning' : 'time'}
            size={16}
            color={color}
          />
          <Text style={[styles.terminalText, { color }]}>{label}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.progressContainer}>
      {LIFECYCLE_STEPS.map((step, idx) => {
        const isActive = idx <= currentIdx;
        const isCurrent = idx === currentIdx;
        const dotColor = isActive ? COLORS.success : COLORS.neutral300;

        return (
          <React.Fragment key={step.key}>
            {/* Connector line (before every dot except the first) */}
            {idx > 0 && (
              <View
                style={[
                  styles.progressLine,
                  { backgroundColor: idx <= currentIdx ? COLORS.success : COLORS.neutral200 },
                ]}
              />
            )}
            {/* Dot + label */}
            <View style={styles.progressStep}>
              <View
                style={[
                  styles.progressDot,
                  { backgroundColor: dotColor },
                  isCurrent && styles.progressDotCurrent,
                ]}
              />
              <Text
                style={[
                  styles.progressLabel,
                  isActive && { color: COLORS.dark, fontWeight: '600' },
                  isCurrent && { color: COLORS.success },
                ]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

export default function RequestDetails() {
  const router = useRouter();
  const params = useLocalSearchParams<{ requestId?: string | string[] }>();
  const requestId = Array.isArray(params.requestId) ? params.requestId[0] : params.requestId;
  const user = useAuthStore((state) => state.user);
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const bumpSync = useSyncStore((s) => s.bumpSync);

  const [request, setRequest] = useState<RequestDetailsData | null>(null);
  const [actionsData, setActionsData] = useState<AvailableActions | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Chat FAB pulse animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const isArtisan = user?.role === 'artisan';
  const isClient = user?.role === 'client';

  const fetchAll = useCallback(async () => {
    if (!requestId) {
      setLoading(false);
      return;
    }
    try {
      const [reqRes, actRes] = await Promise.all([
        api.get(`/requests/${requestId}`),
        api.get(`/requests/${requestId}/available-actions`),
      ]);
      setRequest(reqRes.data);
      setActionsData(actRes.data);
    } catch (error) {
      console.error('Failed to fetch request details:', error);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, syncVersion]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const executeAction = async (
    endpoint: string,
    body?: any,
    confirmMessage?: string,
  ) => {
    if (confirmMessage) {
      return new Promise<void>((resolve) => {
        Alert.alert('Confirmation', confirmMessage, [
          { text: 'Annuler', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Confirmer',
            onPress: async () => {
              await doAction(endpoint, body);
              resolve();
            },
          },
        ]);
      });
    }
    await doAction(endpoint, body);
  };

  const doAction = async (endpoint: string, body?: any) => {
    if (!requestId) return;
    setActionLoading(endpoint);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.post(`/requests/${requestId}/${endpoint}`, body || {});

      // After accept, refetch and navigate to chat (conversation was just created)
      if (endpoint === 'accept') {
        const actRes = await api.get(`/requests/${requestId}/available-actions`);
        setActionsData(actRes.data);
        const reqRes = await api.get(`/requests/${requestId}`);
        setRequest(reqRes.data);
        if (actRes.data.conversation_id) {
          router.push({
            pathname: '/chat',
            params: { conversationId: actRes.data.conversation_id },
          });
        }
      } else {
        await fetchAll();
      }

      // Immediately trigger wallet refresh after mission-impacting actions.
      // Don't rely solely on socket events (unreliable on mobile networks).
      if (endpoint === 'complete' || endpoint === 'confirm') {
        bumpSync('wallet_update', { request_id: requestId });
      }

      if (endpoint === 'confirm' && isClient) {
        const artisanId = request?.assigned_artisan_id || request?.artisan_id;
        if (artisanId) {
          router.push({
            pathname: '/rate-mission',
            params: {
              requestId,
              artisanId,
              serviceName: request?.service_name || request?.service_type || 'Mission',
            },
          });
        }
      }

      if (endpoint === 'dispute') {
        router.push({
          pathname: '/support',
          params: {
            requestId,
            from: 'request-details',
          },
        });
      }
    } catch (error: any) {
      const status = error?.response?.status;
      const detail =
        error?.response?.data?.detail || "Une erreur s'est produite.";
      if (status === 409) {
        Alert.alert('Mission indisponible', detail || 'Cette mission a deja ete acceptee par un autre artisan.');
        await fetchAll();
        return;
      }
      Alert.alert('Erreur', detail);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCall = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const getStatusColor = (status: string) =>
    STATUS_COLORS[status] || COLORS.textLight;
  const getStatusText = (status: string) => STATUS_LABELS[status] || status;

  if (loading) {
    return <SkeletonLoader />;
  }

  if (!request) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.neutral400} />
        <Text style={{ fontSize: 16, color: COLORS.textLight, marginTop: SPACING.md }}>
          Demande introuvable
        </Text>
      </View>
    );
  }

  const status = request.status;
  const actions = actionsData?.actions || [];
  const contact = actionsData?.contact || {};
  const conversationId = actionsData?.conversation_id;
  const canArtisanSeeAddress = !isArtisan || ['artisan_en_route', 'mission_en_cours', 'terminee', 'validee_client', 'litige'].includes(status);

  // Determine the other party's name for the info header
  const otherPartyName = isArtisan
    ? contact.client_name
    : isClient
      ? contact.artisan_name
      : undefined;
  const otherPartyRole = isArtisan ? 'Client' : 'Artisan';

  // Determine which action buttons to show based on backend available-actions
  const renderActionButtons = () => {
    const buttons: React.ReactNode[] = [];

    if (isArtisan) {
      if (actions.includes('send_quote') || status === 'demande_envoyee') {
        buttons.push(
          <TouchableOpacity
            key="accept"
            style={[styles.actionButton, styles.actionButtonPrimary]}
            onPress={() => executeAction('accept')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'accept' ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                <Text style={styles.actionButtonTextLight}>
                  Accepter la mission
                </Text>
              </>
            )}
          </TouchableOpacity>,
        );
        buttons.push(
          <TouchableOpacity
            key="refuse"
            style={[styles.actionButton, styles.actionButtonSecondary]}
            onPress={() =>
              executeAction(
                'refuse',
                { reason: 'refusee_par_artisan' },
                'Refuser cette mission ?',
              )
            }
            disabled={actionLoading !== null}
          >
            <Ionicons name="close-circle" size={20} color={COLORS.text} />
            <Text style={styles.actionButtonTextDark}>Refuser</Text>
          </TouchableOpacity>,
        );
      }

      if (actions.includes('confirm_departure')) {
        buttons.push(
          <TouchableOpacity
            key="en-route"
            style={[styles.actionButton, styles.actionButtonBlue]}
            onPress={() => executeAction('en-route')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'en-route' ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="navigate" size={20} color="#FFF" />
                <Text style={styles.actionButtonTextLight}>
                  Je suis en route
                </Text>
              </>
            )}
          </TouchableOpacity>,
        );
      }

      if (actions.includes('declare_complete') || actions.includes('confirm_arrival')) {
        buttons.push(
          <TouchableOpacity
            key="complete"
            style={[styles.actionButton, styles.actionButtonPrimary]}
            onPress={() =>
              executeAction(
                'complete',
                undefined,
                'Confirmer que la mission est terminee ?',
              )
            }
            disabled={actionLoading !== null}
          >
            {actionLoading === 'complete' ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons
                  name="checkmark-done-circle"
                  size={20}
                  color="#FFF"
                />
                <Text style={styles.actionButtonTextLight}>
                  Mission terminee
                </Text>
              </>
            )}
          </TouchableOpacity>,
        );
      }

      if (actions.includes('dispute')) {
        buttons.push(
          <TouchableOpacity
            key="artisan-dispute"
            style={[styles.actionButton, styles.actionButtonProblem]}
            onPress={() =>
              executeAction(
                'dispute',
                {
                  reason: 'Probleme signale par l artisan',
                  category: 'qualite_service',
                },
                'Confirmer l ouverture du litige ?',
              )
            }
            disabled={actionLoading !== null}
          >
            <Ionicons name="warning" size={20} color="#FF9F0A" />
            <Text style={[styles.actionButtonTextDark, { color: '#FF9F0A' }]}>
              Signaler un probleme
            </Text>
          </TouchableOpacity>,
        );
      }
    }

    if (isClient) {
      if (actions.includes('cancel')) {
        buttons.push(
          <TouchableOpacity
            key="cancel"
            style={[styles.actionButton, styles.actionButtonDanger]}
            onPress={() =>
              executeAction(
                'cancel',
                { reason: 'annulee_par_client' },
                'Annuler cette demande ?',
              )
            }
            disabled={actionLoading !== null}
          >
            <Ionicons name="close-circle" size={20} color="#FF453A" />
            <Text style={[styles.actionButtonTextDark, { color: '#FF453A' }]}>
              Annuler la demande
            </Text>
          </TouchableOpacity>,
        );
      }

      if (actions.includes('validate')) {
        buttons.push(
          <TouchableOpacity
            key="confirm"
            style={[styles.actionButton, styles.actionButtonPrimary]}
            onPress={() =>
              executeAction(
                'confirm',
                { warning_ack: true },
                'Valider la mission ? Les fonds seront liberes.',
              )
            }
            disabled={actionLoading !== null}
          >
            {actionLoading === 'confirm' ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={20} color="#FFF" />
                <Text style={styles.actionButtonTextLight}>
                  Valider la mission
                </Text>
              </>
            )}
          </TouchableOpacity>,
        );
      }

      if (actions.includes('dispute')) {
        buttons.push(
          <TouchableOpacity
            key="client-dispute"
            style={[styles.actionButton, styles.actionButtonProblem]}
            onPress={() =>
              executeAction(
                'dispute',
                {
                  reason: 'Probleme signale par le client',
                  category: 'qualite_service',
                },
                'Un probleme ? Ouvrir un litige et contacter le support ?',
              )
            }
            disabled={actionLoading !== null}
          >
            <Ionicons name="warning" size={20} color="#FF9F0A" />
            <Text style={[styles.actionButtonTextDark, { color: '#FF9F0A' }]}>
              Il y a un probleme
            </Text>
          </TouchableOpacity>,
        );
      }
    }

    if (status === 'litige') {
      buttons.push(
        <TouchableOpacity
          key="support"
          style={[styles.actionButton, styles.actionButtonSecondary]}
          onPress={() =>
            router.push({
              pathname: '/support',
              params: { requestId: request._id, from: 'request-details' },
            })
          }
          disabled={actionLoading !== null}
        >
          <Ionicons name="headset" size={20} color={COLORS.info} />
          <Text style={[styles.actionButtonTextDark, { color: COLORS.info }]}>
            Contacter le support
          </Text>
        </TouchableOpacity>,
      );
    }

    if (buttons.length === 0) return null;

    return (
      <View style={styles.actionsWrapper}>
        {/* Separator */}
        <View style={styles.actionsSeparator} />
        <Text style={styles.actionsSectionTitle}>Actions disponibles</Text>
        <View style={styles.actionsSection}>{buttons}</View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBackBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Details mission</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.info]}
            tintColor={COLORS.info}
          />
        }
      >
        {/* Status progress bar */}
        <StatusProgressBar currentStatus={status} />

        {/* Status badge */}
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(status) + '20' },
          ]}
        >
          <Text
            style={[styles.statusText, { color: getStatusColor(status) }]}
          >
            {getStatusText(status)}
          </Text>
        </View>

        {/* Other party info header */}
        {otherPartyName && (
          <View style={styles.partyHeader}>
            <View style={styles.partyAvatar}>
              <Ionicons name="person" size={18} color={COLORS.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.partyName}>{otherPartyName}</Text>
              <Text style={styles.partyRole}>{otherPartyRole}</Text>
            </View>
          </View>
        )}

        {/* Service + date */}
        <View style={styles.sectionNoPad}>
          <Text style={styles.serviceType}>
            {request.service_name || request.service_type}
          </Text>
          <Text style={styles.date}>
            {format(new Date(request.created_at), 'dd MMMM yyyy', {
              locale: fr,
            })}
          </Text>
        </View>

        {/* Description card */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="document-text-outline" size={18} color={COLORS.neutral500} />
            <Text style={styles.sectionTitle}>Description</Text>
          </View>
          <Text style={styles.description}>{request.description}</Text>
        </View>

        {/* Photos card */}
        {request.photos && request.photos.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="images-outline" size={18} color={COLORS.neutral500} />
              <Text style={styles.sectionTitle}>Photos</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SPACING.xs }}>
              {request.photos.map((photo, index) => (
                <Image
                  key={`${photo}-${index}`}
                  source={{ uri: photo }}
                  style={styles.photo}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Address card */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="location-outline" size={18} color={COLORS.neutral500} />
            <Text style={styles.sectionTitle}>Localisation</Text>
          </View>
          <View style={styles.addressContainer}>
            <Ionicons name={canArtisanSeeAddress ? 'location' : 'lock-closed'} size={20} color={canArtisanSeeAddress ? COLORS.info : COLORS.neutral500} />
            <Text style={styles.address}>
              {canArtisanSeeAddress
                ? request.address
                : "Adresse masquee jusqu'a l'etape 'Je suis en route'."}
            </Text>
          </View>
        </View>

        {/* Budget card */}
        {request.budget && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="wallet-outline" size={18} color={COLORS.neutral500} />
              <Text style={styles.sectionTitle}>Budget</Text>
            </View>
            <Text style={styles.budget}>
              {Number(request.budget).toLocaleString('fr-FR')} FCFA
            </Text>
          </View>
        )}

        {/* Contact card */}
        {(contact.artisan_phone || contact.client_phone) && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="call-outline" size={18} color={COLORS.neutral500} />
              <Text style={styles.sectionTitle}>Contact</Text>
            </View>
            {contact.artisan_phone && (
              <TouchableOpacity
                style={styles.contactRow}
                onPress={() => handleCall(contact.artisan_phone!)}
              >
                <View style={styles.contactIcon}>
                  <Ionicons name="call" size={20} color={COLORS.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>
                    {contact.artisan_name || 'Artisan'}
                  </Text>
                  <Text style={styles.contactPhone}>
                    {contact.artisan_phone}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={COLORS.textLight}
                />
              </TouchableOpacity>
            )}
            {contact.client_phone && (
              <TouchableOpacity
                style={styles.contactRow}
                onPress={() => handleCall(contact.client_phone!)}
              >
                <View style={styles.contactIcon}>
                  <Ionicons name="call" size={20} color={COLORS.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>
                    {contact.client_name || 'Client'}
                  </Text>
                  <Text style={styles.contactPhone}>
                    {contact.client_phone}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={COLORS.textLight}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Action buttons */}
        {renderActionButtons()}
      </ScrollView>

      {/* Floating chat button with pulse */}
      {conversationId && (
        <Animated.View style={[styles.chatFabWrapper, { transform: [{ scale: pulseAnim }] }]}>
          <TouchableOpacity
            style={styles.chatFab}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({
                pathname: '/chat',
                params: { conversationId },
              });
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="chatbubbles" size={24} color="#FFF" />
            <Text style={styles.chatFabText}>Chat</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.neutral50,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.neutral50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBackBtn: {
    padding: SPACING.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.dark,
  },
  content: {
    padding: SPACING.xl,
    paddingBottom: 120,
  },

  // --- Progress bar ---
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING['2xl'],
    paddingHorizontal: SPACING.xs,
  },
  progressStep: {
    alignItems: 'center',
    width: 52,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: SPACING.xs,
  },
  progressDotCurrent: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.white,
    ...SHADOWS.sm,
  },
  progressLine: {
    flex: 1,
    height: 2,
    marginTop: 5,
    borderRadius: 1,
  },
  progressLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.neutral400,
    textAlign: 'center',
    fontWeight: '400',
    marginTop: 1,
  },
  terminalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
  },
  terminalText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // --- Status badge ---
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    marginBottom: SPACING.lg,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // --- Other party header ---
  partyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: RADII.md,
    ...SHADOWS.sm,
  },
  partyAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.info,
    justifyContent: 'center',
    alignItems: 'center',
  },
  partyName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
  },
  partyRole: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 1,
  },

  // --- Service + date (no card) ---
  sectionNoPad: {
    marginBottom: SPACING['2xl'],
  },
  serviceType: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.dark,
    textTransform: 'capitalize',
    marginBottom: SPACING.sm,
  },
  date: {
    fontSize: 14,
    color: COLORS.textLight,
  },

  // --- Card container ---
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    ...SHADOWS.md,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
  },
  description: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 23,
  },
  photo: {
    width: 200,
    height: 200,
    borderRadius: RADII.md,
    marginRight: SPACING.md,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.neutral50,
    borderRadius: RADII.md,
  },
  address: {
    flex: 1,
    fontSize: 14,
    color: COLORS.dark,
    lineHeight: 20,
  },
  budget: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.success,
  },

  // --- Contact ---
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.neutral50,
    borderRadius: RADII.md,
    marginBottom: SPACING.sm,
    gap: SPACING.md,
  },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${COLORS.success}18`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
  },
  contactPhone: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 2,
  },

  // --- Actions ---
  actionsWrapper: {
    marginTop: SPACING.sm,
    marginBottom: SPACING['2xl'],
  },
  actionsSeparator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  actionsSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: SPACING.md,
  },
  actionsSection: {
    gap: SPACING.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.lg,
    borderRadius: RADII.lg,
    gap: SPACING.sm,
  },
  actionButtonPrimary: {
    backgroundColor: COLORS.success,
  },
  actionButtonBlue: {
    backgroundColor: COLORS.info,
  },
  actionButtonSecondary: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionButtonDanger: {
    backgroundColor: '#FF453A10',
    borderWidth: 1,
    borderColor: '#FF453A40',
  },
  actionButtonProblem: {
    backgroundColor: '#FF9F0A10',
    borderWidth: 1,
    borderColor: '#FF9F0A40',
  },
  actionButtonTextLight: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  actionButtonTextDark: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },

  // --- Chat FAB ---
  chatFabWrapper: {
    position: 'absolute',
    bottom: 30,
    right: 20,
  },
  chatFab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.info,
    paddingHorizontal: 22,
    paddingVertical: 15,
    borderRadius: RADII.xl + 8,
    gap: SPACING.sm,
    ...SHADOWS.lg,
  },
  chatFabText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
});
