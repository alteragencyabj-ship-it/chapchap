import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Dimensions,
  StatusBar,
  Animated,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { SERVICE_CATEGORIES, COLORS, STATUS_COLORS, STATUS_LABELS, SHADOWS, SPACING, RADII } from '../../src/config/constants';
import api from '../../src/services/api';
import { useSyncStore } from '../../src/store/syncStore';

const { width } = Dimensions.get('window');
const PADDING = SPACING['2xl'];
const GAP = SPACING.lg;
const CARD_WIDTH = (width - (PADDING * 2) - GAP) / 2;

interface HomeMission {
  _id: string;
  service_type: string;
  service_name?: string;
  status: string;
  created_at: string;
  description?: string;
  assigned_artisan_id?: string;
  artisan_id?: string;
}

const ACTIVE_MISSION_STATUSES = new Set([
  'acceptee',
  'paiement_escrow',
  'artisan_en_route',
  'mission_en_cours',
  'terminee',
]);

// Animated Card Component for Staggered Effect
const AnimatedCard = ({ index, children }: { index: number, children: React.ReactNode }) => {
  const slideAnim = useRef(new Animated.Value(50)).current; // Start 50px down
  const fadeAnim = useRef(new Animated.Value(0)).current;   // Start transparent

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        delay: index * 100, // Stagger by 100ms
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        delay: index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, index, slideAnim]);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
      }}
    >
      {children}
    </Animated.View>
  );
};

// Pulsing Icon Component
const PulsingIcon = () => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Ionicons name="flash" size={40} color={COLORS.iconSand} />
    </Animated.View>
  );
};

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const [missions, setMissions] = useState<HomeMission[]>([]);
  const [missionActions, setMissionActions] = useState<Record<string, string[]>>({});
  const [missionLoading, setMissionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actingMissionId, setActingMissionId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bonjour,';
    if (hour < 18) return 'Bon après-midi,';
    return 'Bonsoir,';
  };

  const fetchClientMissions = useCallback(async () => {
    if (user?.role !== 'client') {
      setMissions([]);
      setMissionActions({});
      return;
    }

    setMissionLoading(true);
    setFetchError(false);
    try {
      const res = await api.get('/requests');
      const all: HomeMission[] = Array.isArray(res.data) ? res.data : [];
      const tracked = all
        .filter((m) => ACTIVE_MISSION_STATUSES.has(String(m?.status || '').toLowerCase()))
        .sort((a, b) => {
          const dateA = a?.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b?.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });
      const activeOnly = tracked.slice(0, 1);

      const actionsMap: Record<string, string[]> = {};
      await Promise.all(
        activeOnly.map(async (m) => {
          try {
            const a = await api.get(`/requests/${m._id}/available-actions`);
            actionsMap[m._id] = Array.isArray(a.data?.actions) ? a.data.actions : [];
          } catch {
            actionsMap[m._id] = [];
          }
        }),
      );

      setMissions(activeOnly);
      setMissionActions(actionsMap);
    } catch (error: any) {
      console.error('Failed to load client missions on home:', error);
      setFetchError(true);
    } finally {
      setMissionLoading(false);
      setRefreshing(false);
    }
  }, [user?.role]);

  // Reload data on screen focus for freshness
  useFocusEffect(
    useCallback(() => {
      fetchClientMissions();
    }, [fetchClientMissions])
  );

  // Also reload when syncVersion changes (socket events)
  useEffect(() => {
    if (syncVersion > 0) {
      fetchClientMissions();
    }
  }, [syncVersion, fetchClientMissions]);

  // Search: filter SERVICE_CATEGORIES
  const filteredCategories = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return SERVICE_CATEGORIES;
    return SERVICE_CATEGORIES.filter((s) =>
      (s?.name || '').toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchClientMissions();
  };

  const runMissionAction = async (mission: HomeMission, endpoint: string) => {
    const requestId = mission?._id;
    if (!requestId) return;
    const bodyMap: Record<string, any> = {
      confirm: { warning_ack: true },
      cancel: { reason: 'annulee_par_client' },
      dispute: {
        reason: 'Probleme signale depuis accueil',
        category: 'qualite_service',
      },
    };

    setActingMissionId(requestId);
    try {
      await api.post(`/requests/${requestId}/${endpoint}`, bodyMap[endpoint] || {});
      await fetchClientMissions();

      if (endpoint === 'dispute') {
        router.push({
          pathname: '/support',
          params: { requestId, from: 'home' },
        });
      }

      if (endpoint === 'confirm') {
        const artisanId = mission.assigned_artisan_id || mission.artisan_id;
        if (artisanId) {
          router.push({
            pathname: '/rate-mission',
            params: {
              requestId,
              artisanId,
              serviceName: mission.service_name || mission.service_type || 'Mission',
            },
          });
        }
      }
    } catch (error: any) {
      const isNetworkError = !error?.response;
      const detail = error?.response?.data?.detail || (isNetworkError
        ? 'Verifiez votre connexion internet.'
        : "L'action a echoue.");
      Alert.alert('Erreur', detail);
    } finally {
      setActingMissionId(null);
    }
  };

  const renderMissionActions = (mission: HomeMission) => {
    const actions = missionActions[mission?._id] || [];
    const busy = actingMissionId === mission?._id;

    return (
      <View style={styles.missionActionsRow}>
        <TouchableOpacity
          style={styles.missionActionGhost}
          onPress={() =>
            router.push({
              pathname: '/request-details',
              params: { requestId: mission._id },
            })
          }
        >
          <Text style={styles.missionActionGhostText}>Suivre</Text>
        </TouchableOpacity>

        {actions.includes('validate') && (
          <TouchableOpacity
            style={[styles.missionActionPrimary, busy && styles.actionDisabled]}
            onPress={() => runMissionAction(mission, 'confirm')}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.missionActionPrimaryText}>Valider</Text>
            )}
          </TouchableOpacity>
        )}

        {actions.includes('cancel') && (
          <TouchableOpacity
            style={[styles.missionActionDanger, busy && styles.actionDisabled]}
            onPress={() => runMissionAction(mission, 'cancel')}
            disabled={busy}
          >
            <Text style={styles.missionActionDangerText}>Annuler</Text>
          </TouchableOpacity>
        )}

        {actions.includes('dispute') && (
          <TouchableOpacity
            style={[styles.missionActionWarn, busy && styles.actionDisabled]}
            onPress={() => runMissionAction(mission, 'dispute')}
            disabled={busy}
          >
            <Text style={styles.missionActionWarnText}>Probleme</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />

      {/* Header Section */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greetingTitle}>{getGreeting()}</Text>
          <Text style={styles.userName}>{user?.name?.split(' ')[0] || 'Client'}</Text>
        </View>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.8}
        >
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {user?.name ? user.name.charAt(0).toUpperCase() : 'C'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />
        }
      >
        {user?.role === 'client' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mission en cours</Text>
            <View style={styles.missionsWrap}>
              {missionLoading && missions.length === 0 ? (
                <View style={styles.missionLoadingBox}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.missionLoadingText}>Chargement des missions...</Text>
                </View>
              ) : fetchError && missions.length === 0 ? (
                <TouchableOpacity
                  style={styles.missionEmptyBox}
                  onPress={onRefresh}
                  activeOpacity={0.7}
                >
                  <Ionicons name="cloud-offline-outline" size={32} color={COLORS.textLight} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.missionEmptyText}>
                      Impossible de charger les missions.
                    </Text>
                    <Text style={[styles.missionEmptyText, { marginTop: 2 }]}>
                      Appuyez ici pour reessayer.
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : missions.length === 0 ? (
                <View style={styles.missionEmptyBox}>
                  <Ionicons name="briefcase-outline" size={32} color={COLORS.textLight} />
                  <Text style={styles.missionEmptyText}>
                    Aucune mission active pour le moment.
                  </Text>
                </View>
              ) : (
                missions.map((mission) => {
                  const status = String(mission?.status || '').toLowerCase();
                  const statusColor = STATUS_COLORS[status] || COLORS.textLight;
                  const statusLabel = STATUS_LABELS[status] || mission?.status || '';
                  return (
                    <View key={mission._id} style={styles.missionCard}>
                      <View style={styles.missionCardHeader}>
                        <Text style={styles.missionTitle} numberOfLines={1}>
                          {mission.service_name || mission.service_type || 'Mission'}
                        </Text>
                        <View style={[styles.missionStatusChip, { backgroundColor: `${statusColor}20` }]}>
                          <Text style={[styles.missionStatusText, { color: statusColor }]}>
                            {statusLabel}
                          </Text>
                        </View>
                      </View>
                      {mission.description ? (
                        <Text style={styles.missionDescription} numberOfLines={2}>
                          {mission.description}
                        </Text>
                      ) : null}
                      {renderMissionActions(mission)}
                    </View>
                  );
                })
              )}
            </View>
          </View>
        )}

        {/* Search Section */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={22} color={COLORS.textLight} />
            <TextInput
              style={styles.searchInput}
              placeholder="De quoi avez-vous besoin ?"
              placeholderTextColor={COLORS.textLight}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity onPress={clearSearch} style={styles.filterButton} activeOpacity={0.7}>
                <Ionicons name="close-circle" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            ) : (
              <View style={styles.filterButton}>
                <Ionicons name="options-outline" size={20} color={COLORS.dark} />
              </View>
            )}
          </View>
        </View>

        {/* Promo Banner with Pulse */}
        <AnimatedCard index={0}>
          <View style={styles.promoBanner}>
            <View style={styles.promoContent}>
              <Text style={styles.promoTitle}>Service Express</Text>
              <Text style={styles.promoText}>Un artisan chez vous en -30 min.</Text>
            </View>
            <View style={styles.promoIcon}>
              <PulsingIcon />
            </View>
          </View>
        </AnimatedCard>

        {/* Services Grid - Animated Stagger */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nos Services</Text>
          <View style={styles.grid}>
            {filteredCategories.length === 0 ? (
              <View style={styles.noSearchResults}>
                <Ionicons name="search-outline" size={28} color={COLORS.textLight} />
                <Text style={styles.noSearchResultsText}>
                  Aucun service ne correspond a "{searchQuery}".
                </Text>
              </View>
            ) : (
              filteredCategories.map((service: any, index: number) => (
                <AnimatedCard key={service.id} index={index + 1}>
                  <TouchableOpacity
                    style={styles.card}
                    onPress={() => router.push({
                      pathname: '/select-service',
                      params: {
                        categoryId: service.id,
                        categoryName: service.name
                      }
                    })}
                    activeOpacity={0.95}
                  >
                    <View style={styles.cardContent}>
                      {/* Watermark Icon */}
                      <View style={styles.watermarkContainer}>
                        <Ionicons
                          name={service.icon || 'construct'}
                          size={90}
                          color={service.color || COLORS.primary}
                          style={{ opacity: 0.08 }}
                        />
                      </View>

                      {/* Foreground Content */}
                      <View style={styles.cardHeader}>
                        <View style={[
                          styles.iconCircle,
                          { backgroundColor: (service.color || COLORS.primary) + '15' }
                        ]}>
                          <Ionicons
                            name={service.icon || 'construct'}
                            size={26}
                            color={service.color || COLORS.primary}
                          />
                        </View>
                      </View>

                      <View style={styles.cardFooter}>
                        <Text style={styles.cardTitle} numberOfLines={2}>
                          {service.name || 'Service'}
                        </Text>
                        <View style={styles.arrowContainer}>
                          <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                </AnimatedCard>
              ))
            )}
          </View>
        </View>

        {/* How it works */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Comment ça marche ?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepsContainer}>
            {[1, 2, 3].map((step, index) => (
              <View key={step} style={styles.stepItem}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepNumber}>{step}</Text>
                  <View style={styles.stepIconParams}>
                    <Ionicons
                      name={index === 0 ? "search" : index === 1 ? "calendar" : "checkmark"}
                      size={24}
                      color={index === 0 ? COLORS.iconSteel : index === 1 ? COLORS.iconSage : COLORS.iconSand}
                    />
                  </View>
                </View>
                <Text style={styles.stepText}>
                  {index === 0 ? "Choisissez" : index === 1 ? "Réservez" : "Profitez"}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: PADDING,
    paddingTop: SPACING.xl,
    marginBottom: SPACING['2xl'],
  },
  greetingTitle: {
    fontSize: 16,
    color: COLORS.textLight,
    fontWeight: '500',
    lineHeight: 22,
    marginBottom: SPACING.xs,
  },
  userName: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.dark,
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  profileButton: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.md,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.iconSteel,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  searchContainer: {
    paddingHorizontal: PADDING,
    marginBottom: SPACING['2xl'],
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADII.xl,
    paddingHorizontal: SPACING.xl,
    height: 56,
    ...SHADOWS.md,
  },
  searchInput: {
    flex: 1,
    marginLeft: SPACING.md,
    fontSize: 15,
    color: COLORS.text,
    height: '100%',
    fontWeight: '500',
  },
  filterButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    paddingLeft: SPACING.lg,
  },
  promoBanner: {
    marginHorizontal: PADDING,
    marginBottom: SPACING['3xl'],
    backgroundColor: COLORS.primary,
    borderRadius: RADII.xl,
    padding: SPACING.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...SHADOWS.lg,
    shadowColor: COLORS.primary,
  },
  promoContent: {
    flex: 1,
    marginRight: SPACING.lg,
  },
  promoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
    lineHeight: 26,
    marginBottom: SPACING.xs + 2,
  },
  promoText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
    lineHeight: 20,
  },
  promoIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginBottom: SPACING['3xl'],
  },
  missionsWrap: {
    paddingHorizontal: PADDING,
    gap: SPACING.md,
  },
  missionLoadingBox: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    ...SHADOWS.sm,
  },
  missionLoadingText: {
    color: COLORS.textLight,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  missionEmptyBox: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    ...SHADOWS.sm,
  },
  missionEmptyText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
  },
  missionCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  missionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  missionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
    textTransform: 'capitalize',
    lineHeight: 20,
  },
  missionStatusChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADII.pill,
  },
  missionStatusText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  missionDescription: {
    color: COLORS.textLight,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  missionActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  missionActionGhost: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
  missionActionGhostText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  missionActionPrimary: {
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    minWidth: 74,
    alignItems: 'center',
  },
  missionActionPrimaryText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  missionActionDanger: {
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: COLORS.error + '18',
  },
  missionActionDangerText: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  missionActionWarn: {
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: COLORS.iconSand + '18',
  },
  missionActionWarnText: {
    color: COLORS.iconSand,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.dark,
    marginBottom: SPACING.xl,
    paddingHorizontal: PADDING,
    letterSpacing: -0.5,
    lineHeight: 28,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: PADDING,
  },
  card: {
    width: CARD_WIDTH,
    height: 170,
    borderRadius: RADII.xl,
    backgroundColor: COLORS.white,
    ...SHADOWS.md,
    marginBottom: SPACING.sm,
  },
  cardContent: {
    flex: 1,
    borderRadius: RADII.xl,
    padding: SPACING.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  watermarkContainer: {
    position: 'absolute',
    right: -25,
    bottom: -25,
    transform: [{ rotate: '-10deg' }],
  },
  cardHeader: {
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
    flex: 1,
    marginRight: SPACING.sm,
    lineHeight: 20,
  },
  arrowContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noSearchResults: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  noSearchResultsText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  stepsContainer: {
    paddingHorizontal: PADDING,
    gap: SPACING['2xl'],
  },
  stepItem: {
    alignItems: 'center',
    gap: SPACING.md,
  },
  stepCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.md,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  stepNumber: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.dark,
    color: COLORS.white,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 12,
    fontWeight: 'bold',
    overflow: 'hidden',
    zIndex: 10,
  },
  stepIconParams: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.light,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 20,
  },
});
