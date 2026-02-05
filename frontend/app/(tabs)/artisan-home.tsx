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
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/services/api';
import { COLORS } from '../../src/config/constants';
import { useAuthStore } from '../../src/store/authStore';

const { width } = Dimensions.get('window');

const LEVEL_COLORS: Record<string, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  diamond: '#B9F2FF',
};

const LEVEL_ICONS: Record<string, string> = {
  bronze: 'shield-outline',
  silver: 'shield-half-outline',
  gold: 'shield',
  diamond: 'diamond',
};

interface CreditStatus {
  level: string;
  level_name: string;
  credit_remaining: number;
  credit_max: number;
  commission_due: number;
  commission_rate_percent: string;
  is_blocked: boolean;
  can_accept_mission: boolean;
  total_earned: number;
  next_level: string | null;
  next_level_name: string | null;
  missions_to_next_level: number | null;
}

interface Request {
  _id: string;
  service_type: string;
  description: string;
  address: string;
  created_at: string;
  budget?: number;
}

export default function ArtisanDashboard() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [credit, setCredit] = useState<CreditStatus | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [creditRes, requestsRes] = await Promise.allSettled([
        api.get('/credit/status'),
        api.get('/requests/available'),
      ]);

      if (creditRes.status === 'fulfilled') {
        setCredit(creditRes.value.data);
      }
      if (requestsRes.status === 'fulfilled') {
        setRequests(requestsRes.value.data);
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
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

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
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
              {credit?.level_name || 'Bronze'}
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
                <Text style={styles.creditInfoLabel}>Taux</Text>
                <Text style={styles.creditInfoValue}>{credit?.commission_rate_percent || '15%'}</Text>
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
            <TouchableOpacity onPress={() => router.push('/(tabs)/my-missions')}>
              <Text style={styles.seeAllText}>Voir tout</Text>
            </TouchableOpacity>
          </View>

          {requests.length === 0 ? (
            <View style={styles.emptyMissions}>
              <Ionicons name="briefcase-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.emptyText}>Aucune mission disponible</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
  },
  greeting: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  levelText: {
    fontSize: 13,
    fontWeight: '700',
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.danger,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  alertText: {
    flex: 1,
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  creditCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  creditCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
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
  },
  creditLabel: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  creditSubLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
  },
  creditInfo: {
    flex: 1,
    gap: 8,
  },
  creditInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  creditInfoLabel: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  creditInfoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.dark,
  },
  walletButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
  },
  walletButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  progressContainer: {
    marginTop: 16,
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
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  nextLevelCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
  },
  nextLevelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  nextLevelTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
  },
  nextLevelInfo: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 10,
  },
  nextLevelProgressBar: {
    height: 4,
    backgroundColor: COLORS.light,
    borderRadius: 2,
  },
  nextLevelProgressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  seeAllText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  emptyMissions: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: COLORS.white,
    borderRadius: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
  },
  missionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  missionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  },
  missionAddress: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  missionBudget: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.secondary,
  },
});
