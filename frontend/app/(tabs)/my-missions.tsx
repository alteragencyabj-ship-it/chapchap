import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  SectionList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import api from '../../src/services/api';
import { useMissionStore } from '../../src/store/missionStore';
import { useSyncStore } from '../../src/store/syncStore';
import { COLORS, STATUS_COLORS, STATUS_LABELS, SHADOWS, RADII, SPACING } from '../../src/config/constants';
import { format, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Mission {
  _id: string;
  service_type: string;
  service_name?: string;
  description: string;
  status: string;
  created_at: string;
  address: string;
  budget?: number;
}

interface MissionSection {
  title: string;
  key: string;
  data: Mission[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an amount with French locale and FCFA suffix. */
function formatFCFA(amount: number): string {
  return `${Number(amount).toLocaleString('fr-FR')} FCFA`;
}

/** Return a human-readable relative time string in French. */
function relativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diffMs = now - then;
  if (diffMs < 0) return "a l'instant";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes}min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days}j`;

  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;

  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

/** Format date consistently across all screens, with null safety. */
function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isValid(d)) return '';
    return format(d, 'dd MMM yyyy', { locale: fr });
  } catch {
    return '';
  }
}

/** Section color used for the accent bar and section dot. */
const SECTION_META: Record<string, { label: string; color: string; icon: string }> = {
  new: { label: 'Nouvelles demandes', color: COLORS.info, icon: 'notifications' },
  active: { label: 'Missions en cours', color: STATUS_COLORS.artisan_en_route, icon: 'briefcase' },
  done: { label: 'Terminees', color: COLORS.success, icon: 'checkmark-circle' },
  history: { label: 'Historique', color: COLORS.neutral500, icon: 'archive' },
};

function sectionKeyForStatus(status: string): string {
  if (status === 'demande_envoyee') return 'new';
  if (['devis_envoye', 'acceptee', 'artisan_en_route', 'mission_en_cours'].includes(status)) return 'active';
  if (['terminee', 'validee_client'].includes(status)) return 'done';
  if (['annulee', 'expiree', 'litige'].includes(status)) return 'history';
  return 'history'; // fallback
}

// ---------------------------------------------------------------------------
// Shimmer placeholder
// ---------------------------------------------------------------------------

function ShimmerCard({ delay }: { delay: number }) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          delay,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim, delay]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.08, 0.18],
  });

  const barStyle = (width: number | `${number}%`, height: number, mb = 0) => ({
    width,
    height,
    borderRadius: RADII.sm,
    marginBottom: mb,
    backgroundColor: COLORS.neutral400,
    opacity,
  });

  return (
    <View style={[styles.missionCard, { overflow: 'hidden' }]}>
      {/* Accent bar placeholder */}
      <View style={[styles.accentBar, { backgroundColor: COLORS.neutral200 }]} />
      <View style={styles.cardBody}>
        <View style={styles.missionHeader}>
          <Animated.View style={[barStyle(44, 44), { borderRadius: 22 }]} />
          <View style={styles.flexColumnGap}>
            <Animated.View style={barStyle('60%', 14)} />
            <Animated.View style={barStyle('40%', 10)} />
          </View>
          <Animated.View style={barStyle(64, 24, 0)} />
        </View>
        <Animated.View style={barStyle('90%', 12, 6)} />
        <Animated.View style={barStyle('70%', 12, 12)} />
        <View style={styles.missionFooter}>
          <Animated.View style={barStyle(80, 10)} />
          <Animated.View style={barStyle(60, 14)} />
        </View>
      </View>
    </View>
  );
}

function ShimmerLoading() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mes Missions</Text>
      </View>
      <View style={styles.listContent}>
        {[0, 150, 300, 450].map((d, i) => (
          <ShimmerCard key={i} delay={d} />
        ))}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MyMissions() {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const resetMissionCount = useMissionStore((s) => s.resetCount);
  const fetchMissionCount = useMissionStore((s) => s.fetchCount);
  const syncVersion = useSyncStore((s) => s.syncVersion);

  const fetchMissions = useCallback(async () => {
    try {
      setFetchError(false);
      const response = await api.get('/requests');
      setMissions(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch missions:', error);
      setFetchError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions, syncVersion]);

  // Re-fetch data + reset badge count when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      resetMissionCount();
      fetchMissions();
    }, [resetMissionCount, fetchMissions])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchMissions();
  };

  const handleAcceptInline = async (missionId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAcceptingId(missionId);
    try {
      await api.post(`/requests/${missionId}/accept`);
      await fetchMissions();
      fetchMissionCount();
    } catch (error: any) {
      const httpStatus = error?.response?.status;
      const detail = error?.response?.data?.detail || "Impossible d'accepter cette mission.";
      if (httpStatus === 409) {
        Alert.alert('Mission indisponible', detail || 'Cette mission a deja ete acceptee par un autre artisan.');
        await fetchMissions();
        return;
      }
      Alert.alert('Erreur', detail);
    } finally {
      setAcceptingId(null);
    }
  };

  const getStatusColor = (status: string) => STATUS_COLORS[status] || COLORS.textLight;
  const getStatusText = (status: string) => STATUS_LABELS[status] || status;

  const isNewMission = (status: string) => status === 'demande_envoyee';

  // Sort: new missions first, then by date
  const sortedMissions = [...missions].sort((a, b) => {
    const aNew = isNewMission(a.status) ? 0 : 1;
    const bNew = isNewMission(b.status) ? 0 : 1;
    if (aNew !== bNew) return aNew - bNew;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // ---- Build sections ----
  const sectionMap: Record<string, Mission[]> = { new: [], active: [], done: [], history: [] };
  sortedMissions.forEach((m) => {
    const key = sectionKeyForStatus(m.status);
    sectionMap[key].push(m);
  });

  const sections: MissionSection[] = (['new', 'active', 'done', 'history'] as const)
    .filter((key) => sectionMap[key].length > 0)
    .map((key) => ({
      title: SECTION_META[key].label,
      key,
      data: sectionMap[key],
    }));

  // ---- Counts for summary bar ----
  const countNew = sectionMap.new.length;
  const countActive = sectionMap.active.length;
  const countDone = sectionMap.done.length;
  const countHistory = sectionMap.history.length;

  // ---- Render helpers ----

  const renderSectionHeader = ({ section }: { section: MissionSection }) => {
    const meta = SECTION_META[section.key];
    return (
      <View style={styles.sectionHeader}>
        <Ionicons name={meta.icon as any} size={18} color={meta.color} />
        <Text style={styles.sectionHeaderText}>{section.title}</Text>
        <View style={[styles.sectionCount, { backgroundColor: meta.color + '18' }]}>
          <Text style={[styles.sectionCountText, { color: meta.color }]}>{section.data.length}</Text>
        </View>
      </View>
    );
  };

  const renderMission = ({ item }: { item: Mission }) => {
    const isNew = isNewMission(item.status);
    const sKey = sectionKeyForStatus(item.status);
    const accentColor = SECTION_META[sKey].color;

    return (
      <TouchableOpacity
        style={[
          styles.missionCard,
          isNew && styles.missionCardNew,
        ]}
        activeOpacity={0.7}
        onPress={() => {
          // Don't navigate if an accept is in progress for this card
          if (acceptingId === item._id) return;
          router.push({
            pathname: '/request-details',
            params: { requestId: item._id },
          });
        }}
      >
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: accentColor }]} />

        <View style={styles.cardBody}>
          <View style={styles.missionHeader}>
            <View style={[styles.missionIcon, { backgroundColor: accentColor + '14' }]}>
              <Ionicons
                name={isNew ? 'notifications' : 'briefcase'}
                size={22}
                color={accentColor}
              />
            </View>
            <View style={styles.flexOne}>
              <View style={styles.serviceRow}>
                <Text style={styles.missionService} numberOfLines={1}>
                  {item.service_name || item.service_type}
                </Text>
                {isNew && (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>Nouveau</Text>
                  </View>
                )}
              </View>
              <Text style={styles.missionAddress} numberOfLines={1}>
                {['artisan_en_route', 'mission_en_cours', 'terminee', 'validee_client', 'litige'].includes(item.status)
                  ? item.address
                  : "Adresse masquee jusqu'a l'etape 'Je suis en route'"}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '18' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
                {getStatusText(item.status)}
              </Text>
            </View>
          </View>

          <Text style={styles.missionDescription} numberOfLines={2}>
            {item.description}
          </Text>

          {/* Budget row -- prominent */}
          {item.budget ? (
            <View style={styles.budgetRow}>
              <Ionicons name="cash-outline" size={16} color={COLORS.dark} />
              <Text style={styles.budgetAmount}>
                {formatFCFA(item.budget)}
              </Text>
            </View>
          ) : null}

          <View style={styles.missionFooter}>
            <Text style={styles.missionDate}>
              {formatDate(item.created_at)}
            </Text>
            <Text style={styles.missionElapsed}>
              {relativeTime(item.created_at)}
            </Text>
          </View>

          {/* Inline accept button for new missions -- full width, prominent */}
          {isNew && (
            <TouchableOpacity
              style={styles.acceptButton}
              onPress={(e) => {
                e.stopPropagation();
                handleAcceptInline(item._id);
              }}
              disabled={acceptingId !== null}
              activeOpacity={0.8}
            >
              <View style={styles.acceptButtonInner}>
                <View style={styles.acceptGradientTop} />
                {acceptingId === item._id ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <View style={styles.acceptButtonContent}>
                    <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                    <Text style={styles.acceptButtonText}>Accepter la mission</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ---- Loading state: shimmer ----
  if (loading) {
    return <ShimmerLoading />;
  }

  // ---- Main render ----
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mes Missions</Text>
      </View>

      {/* Summary bar */}
      {missions.length > 0 && (
        <View style={styles.summaryBar}>
          {countNew > 0 && (
            <View style={styles.summaryItem}>
              <View style={[styles.summaryDot, { backgroundColor: SECTION_META.new.color }]} />
              <Text style={styles.summaryText}>{countNew} nouvelle{countNew > 1 ? 's' : ''}</Text>
            </View>
          )}
          {countNew > 0 && countActive > 0 && <Text style={styles.summarySep}>{'\u00B7'}</Text>}
          {countActive > 0 && (
            <View style={styles.summaryItem}>
              <View style={[styles.summaryDot, { backgroundColor: SECTION_META.active.color }]} />
              <Text style={styles.summaryText}>{countActive} en cours</Text>
            </View>
          )}
          {(countNew > 0 || countActive > 0) && countDone > 0 && (
            <Text style={styles.summarySep}>{'\u00B7'}</Text>
          )}
          {countDone > 0 && (
            <View style={styles.summaryItem}>
              <View style={[styles.summaryDot, { backgroundColor: SECTION_META.done.color }]} />
              <Text style={styles.summaryText}>{countDone} terminee{countDone > 1 ? 's' : ''}</Text>
            </View>
          )}
          {(countNew > 0 || countActive > 0 || countDone > 0) && countHistory > 0 && (
            <Text style={styles.summarySep}>{'\u00B7'}</Text>
          )}
          {countHistory > 0 && (
            <View style={styles.summaryItem}>
              <View style={[styles.summaryDot, { backgroundColor: SECTION_META.history.color }]} />
              <Text style={styles.summaryText}>{countHistory} historique</Text>
            </View>
          )}
        </View>
      )}

      {fetchError && missions.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neutral500} colors={[COLORS.primary]} />
          }
        >
          <Ionicons name="cloud-offline-outline" size={64} color={COLORS.neutral400} />
          <Text style={styles.emptyText}>Connexion impossible</Text>
          <Text style={styles.emptySubtext}>
            Impossible de charger vos missions. Verifiez votre connexion et tirez vers le bas pour reessayer.
          </Text>
        </ScrollView>
      ) : missions.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neutral500} colors={[COLORS.primary]} />
          }
        >
          <Ionicons name="briefcase-outline" size={64} color={COLORS.neutral400} />
          <Text style={styles.emptyText}>Aucune mission en cours</Text>
          <Text style={styles.emptySubtext}>
            Les nouvelles demandes apparaitront ici. Restez disponible pour recevoir vos premieres missions !
          </Text>
        </ScrollView>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderMission}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.neutral500}
              colors={[COLORS.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.neutral50,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.dark,
    letterSpacing: -0.3,
  },

  // ---- Summary bar ----
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 6,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.neutral600,
  },
  summarySep: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.neutral300,
    marginHorizontal: 2,
  },

  // ---- Section headers ----
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.sm + 2,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.dark,
    flex: 1,
  },
  sectionCount: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // ---- List ----
  listContent: {
    padding: SPACING.lg,
    paddingBottom: 120,
  },

  // ---- Card ----
  missionCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    marginBottom: SPACING.md,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  missionCardNew: {
    borderColor: COLORS.info + '50',
    borderWidth: 1.5,
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  cardBody: {
    flex: 1,
    padding: SPACING.lg - 2,
  },
  missionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm + 2,
  },
  missionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flexOne: {
    flex: 1,
  },
  flexColumnGap: {
    flex: 1,
    gap: 6,
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  missionService: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
    textTransform: 'capitalize',
    flexShrink: 1,
  },
  missionAddress: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 5,
    borderRadius: RADII.sm,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  newBadge: {
    backgroundColor: COLORS.info + '18',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADII.sm,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.info,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  missionDescription: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: SPACING.sm,
    lineHeight: 20,
  },

  // ---- Budget ----
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.sm + 2,
    backgroundColor: COLORS.neutral100,
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 5,
    borderRadius: RADII.sm,
  },
  budgetAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.dark,
    letterSpacing: -0.2,
  },

  // ---- Footer ----
  missionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  missionDate: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  missionElapsed: {
    fontSize: 12,
    color: COLORS.neutral500,
    fontStyle: 'italic',
  },

  // ---- Accept button (prominent, full-width, two-tone) ----
  acceptButton: {
    marginTop: SPACING.md,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  acceptButtonInner: {
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.lg - 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    minHeight: 48,
  },
  acceptGradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: COLORS.success,
    borderTopLeftRadius: RADII.md,
    borderTopRightRadius: RADII.md,
    opacity: 0.85,
  },
  acceptButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    zIndex: 1,
  },
  acceptButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: 0.2,
  },

  // ---- Empty state ----
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING['3xl'] + SPACING.sm,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginTop: SPACING.lg,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
    lineHeight: 20,
    paddingHorizontal: SPACING.lg,
  },
});
