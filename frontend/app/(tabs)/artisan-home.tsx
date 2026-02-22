import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Image,
  Share,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/services/api';
import { COLORS, SHADOWS, SPACING, RADII } from '../../src/config/constants';
import { useAuthStore } from '../../src/store/authStore';
import { useSyncStore } from '../../src/store/syncStore';

const LEVEL_COLORS: Record<string, string> = {
  fixed: COLORS.primary,
  bronze: COLORS.iconSand,
  silver: COLORS.iconSteel,
  gold: COLORS.iconSage,
  diamond: COLORS.iconIce,
};

const LEVEL_ICONS: Record<string, string> = {
  fixed: 'shield-checkmark',
  bronze: 'shield-outline',
  silver: 'shield-half-outline',
  gold: 'shield',
  diamond: 'diamond',
};

interface CreditStatus {
  level: string;
  level_name?: string;
  credit_remaining: number;
  credit_max: number;
  commission_due: number;
  commission_rate_percent?: string;
  commission_per_mission?: number;
  is_blocked: boolean;
  can_accept_mission: boolean;
  total_earned: number;
  next_level?: string | null;
  next_level_name?: string | null;
  missions_to_next_level?: number | null;
}

interface Request {
  _id: string;
  service_type: string;
  description: string;
  address: string;
  created_at: string;
  budget?: number;
}

interface ReferralInfo {
  referral_id: string;
  affiliated_clients_count: number;
  referral_link: string;
  qr_payload: string;
  qr_code_url: string;
}

export default function ArtisanDashboard() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const syncVersion = useSyncStore((state) => state.syncVersion);
  const [credit, setCredit] = useState<CreditStatus | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [creditRes, requestsRes, referralRes] = await Promise.allSettled([
        api.get('/credit/status'),
        api.get('/requests/available'),
        api.get('/artisans/referral/me'),
      ]);

      if (creditRes.status === 'fulfilled') {
        setCredit(creditRes.value.data);
      }
      if (requestsRes.status === 'fulfilled') {
        setRequests(requestsRes.value.data);
      }
      if (referralRes.status === 'fulfilled') {
        setReferralInfo(referralRes.value.data);
      }
    } catch (error) {
      console.error('Dashboard fetch error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, syncVersion]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleShareReferral = useCallback(async () => {
    if (!referralInfo) return;
    try {
      await Share.share({
        message: `Rejoins ARTISAN avec mon code ${referralInfo.referral_id}. Lien: ${referralInfo.referral_link}`,
      });
    } catch (error) {
      console.error('Referral share failed:', error);
      Alert.alert('Partage impossible', 'Impossible de partager le code pour le moment.');
    }
  }, [referralInfo]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const creditProgress = credit ? credit.credit_remaining / credit.credit_max : 0;
  const levelColor = credit ? LEVEL_COLORS[credit.level] || COLORS.primary : COLORS.primary;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Bonjour,</Text>
            <Text style={styles.name}>{user?.name || 'Artisan'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.levelBadge, { backgroundColor: levelColor + '20', borderColor: levelColor }]}
            onPress={() => router.push('/(tabs)/wallet')}
          >
            <Ionicons
              name={LEVEL_ICONS[credit?.level || 'bronze'] as any}
              size={16}
              color={levelColor}
            />
            <Text style={[styles.levelText, { color: levelColor }]}>
              {credit?.level_name || 'Plan fixe'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Alert Banner */}
        {credit?.is_blocked && (
          <TouchableOpacity
            style={styles.alertBanner}
            onPress={() => router.push('/(tabs)/wallet')}
          >
            <Ionicons name="warning" size={20} color={COLORS.white} />
            <Text style={styles.alertText}>
              Compte bloque - Reglez votre commission pour continuer
            </Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.white} />
          </TouchableOpacity>
        )}

        {!credit?.is_blocked && credit && credit.credit_remaining <= 1 && (
          <TouchableOpacity
            style={[styles.alertBanner, { backgroundColor: COLORS.warning }]}
            onPress={() => router.push('/(tabs)/wallet')}
          >
            <Ionicons name="alert-circle" size={20} color={COLORS.white} />
            <Text style={styles.alertText}>
              {credit.credit_remaining === 0
                ? 'Plus de credit - Reglez votre commission'
                : `Attention: il vous reste ${credit.credit_remaining} credit`}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.white} />
          </TouchableOpacity>
        )}

        {/* Credit Card */}
        <View style={styles.creditCard}>
          <View style={styles.creditCardTop}>
            <View style={styles.creditCircleContainer}>
              <View style={styles.creditCircle}>
                <Text style={styles.creditNumber}>{credit?.credit_remaining ?? 0}</Text>
                <Text style={styles.creditLabel}>/{credit?.credit_max ?? 3}</Text>
              </View>
              <Text style={styles.creditSubLabel}>Credits</Text>
            </View>

            <View style={styles.creditInfo}>
              <View style={styles.creditInfoRow}>
                <Text style={styles.creditInfoLabel}>Commission</Text>
                <Text style={styles.creditInfoValue}>
                  {(credit?.commission_due ?? 0).toLocaleString('fr-FR')} FCFA
                </Text>
              </View>
              <View style={styles.creditInfoRow}>
                <Text style={styles.creditInfoLabel}>Tarification</Text>
                <Text style={styles.creditInfoValue}>
                  {credit?.commission_rate_percent || `${(credit?.commission_per_mission || 2000).toLocaleString('fr-FR')} FCFA / mission`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.walletButton}
                onPress={() => router.push('/(tabs)/wallet')}
              >
                <Ionicons name="wallet-outline" size={16} color={COLORS.white} />
                <Text style={styles.walletButtonText}>Portefeuille</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${creditProgress * 100}%`,
                    backgroundColor: creditProgress > 0.3 ? COLORS.secondary : COLORS.danger,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Ionicons name="cash-outline" size={24} color={COLORS.secondary} />
            <Text style={styles.statValue}>
              {((credit?.total_earned ?? 0) / 1000).toFixed(0)}k
            </Text>
            <Text style={styles.statLabel}>Gains (FCFA)</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="briefcase-outline" size={24} color={COLORS.primary} />
            <Text style={styles.statValue}>{user?.total_missions || 0}</Text>
            <Text style={styles.statLabel}>Missions</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="star" size={24} color={COLORS.warning} />
            <Text style={styles.statValue}>{user?.average_rating?.toFixed(1) || '0.0'}</Text>
            <Text style={styles.statLabel}>Note</Text>
          </View>
        </View>

        {referralInfo && (
          <View style={styles.referralCard}>
            <View style={styles.referralHeader}>
              <View style={styles.referralHeaderLeft}>
                <Text style={styles.referralTitle}>Clients affilies: {referralInfo.affiliated_clients_count}</Text>
                <Text style={styles.referralSubtitle}>
                  Plus tu invites de clients, plus tu es recommande dans l'app.
                </Text>
              </View>
              <TouchableOpacity style={styles.referralShareButton} onPress={handleShareReferral}>
                <Ionicons name="share-social-outline" size={16} color={COLORS.white} />
                <Text style={styles.referralShareText}>Inviter un client</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.referralCodeRow}>
              <Text style={styles.referralCodeLabel}>Code manuel</Text>
              <Text style={styles.referralCodeValue}>{referralInfo.referral_id}</Text>
            </View>
            <Text style={styles.referralLinkText} numberOfLines={1}>
              {referralInfo.referral_link}
            </Text>

            <View style={styles.referralQrWrap}>
              <Image
                source={{ uri: referralInfo.qr_code_url }}
                style={styles.referralQr}
                resizeMode="contain"
              />
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.profilePromptCard}
          onPress={() => router.push('/edit-profile-artisan')}
          activeOpacity={0.9}
        >
          <View style={styles.profilePromptIcon}>
            <Ionicons name="create-outline" size={20} color={COLORS.primary} />
          </View>
          <View style={styles.profilePromptContent}>
            <Text style={styles.profilePromptTitle}>Completer mon profil artisan</Text>
            <Text style={styles.profilePromptSubtitle}>
              Ajoutez photos, experience, specialites et portfolio pour inspirer confiance.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* Next Level */}
        {credit?.next_level && (
          <View style={styles.nextLevelCard}>
            <View style={styles.nextLevelHeader}>
              <Ionicons name="trending-up" size={20} color={COLORS.primary} />
              <Text style={styles.nextLevelTitle}>
                Prochain niveau: {credit.next_level_name}
              </Text>
            </View>
            <Text style={styles.nextLevelInfo}>
              Encore {credit.missions_to_next_level} missions pour atteindre le niveau{' '}
              {credit.next_level_name}
            </Text>
            <View style={styles.nextLevelProgressBar}>
              <View
                style={[
                  styles.nextLevelProgressFill,
                  {
                    width: credit.missions_to_next_level
                      ? `${Math.max(5, 100 - (credit.missions_to_next_level / 20) * 100)}%`
                      : '100%',
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* Available Missions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Missions disponibles</Text>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => router.push('/(tabs)/my-missions')}
            >
              <Text style={styles.seeAllText}>Voir tout</Text>
            </TouchableOpacity>
          </View>

          {requests.length === 0 ? (
            <View style={styles.emptyMissions}>
              <Ionicons name="briefcase-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.emptyText}>Aucune mission disponible pour le moment</Text>
            </View>
          ) : (
            requests.slice(0, 3).map((item) => (
              <TouchableOpacity
                key={item._id}
                style={styles.missionCard}
                onPress={() =>
                  router.push({
                    pathname: '/request-details',
                    params: { requestId: item._id },
                  })
                }
              >
                <View style={styles.missionIcon}>
                  <Ionicons name="construct" size={20} color={COLORS.primary} />
                </View>
                <View style={styles.missionInfo}>
                  <Text style={styles.missionService} numberOfLines={1}>
                    {item.service_type}
                  </Text>
                  <Text style={styles.missionAddress} numberOfLines={1}>
                    {item.address}
                  </Text>
                </View>
                {item.budget && (
                  <Text style={styles.missionBudget}>
                    {item.budget.toLocaleString('fr-FR')} F
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const HORIZONTAL_PADDING = SPACING.lg;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.light,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.light,
  },
  greeting: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.dark,
    lineHeight: 28,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.xl,
    borderWidth: 1,
    minHeight: 44,
  },
  levelText: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.danger,
    marginHorizontal: HORIZONTAL_PADDING,
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADII.md,
    minHeight: 48,
  },
  alertText: {
    flex: 1,
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  creditCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: HORIZONTAL_PADDING,
    marginTop: SPACING.lg,
    borderRadius: RADII.xl,
    padding: SPACING.xl,
    ...SHADOWS.md,
  },
  creditCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xl,
  },
  creditCircleContainer: {
    alignItems: 'center',
  },
  creditCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  creditNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.primary,
    lineHeight: 34,
  },
  creditLabel: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    lineHeight: 20,
  },
  creditSubLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    lineHeight: 16,
  },
  creditInfo: {
    flex: 1,
    gap: SPACING.sm,
  },
  creditInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  creditInfoLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
  },
  creditInfoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.dark,
    lineHeight: 18,
  },
  walletButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs + 2,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: RADII.sm,
    marginTop: SPACING.xs,
    minHeight: 44,
  },
  walletButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  progressContainer: {
    marginTop: SPACING.lg,
  },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.light,
    borderRadius: 3,
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: HORIZONTAL_PADDING,
    marginTop: SPACING.lg,
    gap: SPACING.sm + 2,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    gap: SPACING.xs + 2,
    ...SHADOWS.sm,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    lineHeight: 26,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  referralCard: {
    marginHorizontal: HORIZONTAL_PADDING,
    marginTop: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  referralHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  referralHeaderLeft: {
    flex: 1,
  },
  referralTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
    lineHeight: 20,
  },
  referralSubtitle: {
    marginTop: SPACING.xs,
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  referralShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    backgroundColor: COLORS.primary,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    minHeight: 44,
  },
  referralShareText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  referralCodeRow: {
    marginTop: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  referralCodeLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  referralCodeValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.dark,
    letterSpacing: 0.5,
    lineHeight: 20,
  },
  referralLinkText: {
    marginTop: SPACING.xs + 2,
    fontSize: 11,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  referralQrWrap: {
    marginTop: SPACING.md,
    width: 98,
    height: 98,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.light,
  },
  referralQr: {
    width: 86,
    height: 86,
    borderRadius: RADII.sm,
  },
  profilePromptCard: {
    marginHorizontal: HORIZONTAL_PADDING,
    marginTop: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: 56,
    ...SHADOWS.sm,
  },
  profilePromptIcon: {
    width: 40,
    height: 40,
    borderRadius: RADII.xl,
    backgroundColor: COLORS.primary + '16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePromptContent: {
    flex: 1,
  },
  profilePromptTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.dark,
    lineHeight: 20,
  },
  profilePromptSubtitle: {
    marginTop: SPACING.xs,
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  nextLevelCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: HORIZONTAL_PADDING,
    marginTop: SPACING.lg,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    ...SHADOWS.sm,
  },
  nextLevelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  nextLevelTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    lineHeight: 20,
  },
  nextLevelInfo: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: SPACING.md,
    lineHeight: 16,
  },
  nextLevelProgressBar: {
    height: 6,
    backgroundColor: COLORS.light,
    borderRadius: 3,
  },
  nextLevelProgressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  section: {
    marginTop: SPACING.xl,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingBottom: 120,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    lineHeight: 24,
  },
  seeAllButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xs,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
    lineHeight: 20,
  },
  emptyMissions: {
    alignItems: 'center',
    padding: SPACING['3xl'],
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    gap: SPACING.sm,
    ...SHADOWS.sm,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: SPACING.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  missionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm + 2,
    gap: SPACING.md,
    minHeight: 56,
    ...SHADOWS.sm,
  },
  missionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  missionInfo: {
    flex: 1,
  },
  missionService: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    textTransform: 'capitalize',
    lineHeight: 20,
  },
  missionAddress: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    lineHeight: 16,
  },
  missionBudget: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.secondary,
    lineHeight: 18,
  },
});
