import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import api from '../../src/services/api';
import { COLORS, SHADOWS, RADII, SPACING } from '../../src/config/constants';
import { useSyncStore } from '../../src/store/syncStore';
import { format, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<string, string> = {
  fixed: COLORS.primary,
  bronze: COLORS.iconSand,
  silver: COLORS.iconSteel,
  gold: COLORS.iconSage,
  diamond: COLORS.iconIce,
};

const LEVEL_BENEFITS: Record<string, string[]> = {
  fixed: ['5 missions par cycle', '2 000 FCFA par mission', 'Paiement exact au blocage (10 000 FCFA)'],
  bronze: ['5 missions par cycle', '2 000 FCFA par mission', 'Paiement exact au blocage (10 000 FCFA)'],
  silver: ['5 missions par cycle', '2 000 FCFA par mission', 'Paiement exact au blocage (10 000 FCFA)'],
  gold: ['5 missions par cycle', '2 000 FCFA par mission', 'Paiement exact au blocage (10 000 FCFA)'],
  diamond: ['5 missions par cycle', '2 000 FCFA par mission', 'Paiement exact au blocage (10 000 FCFA)'],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreditStatus {
  level: string;
  level_name?: string;
  credit_remaining: number;
  credit_max: number;
  commission_due: number;
  commission_rate?: number;
  commission_rate_percent?: string;
  commission_per_mission?: number;
  is_blocked: boolean;
  can_accept_mission: boolean;
  total_earned: number;
  total_paid: number;
  next_level?: string | null;
  next_level_name?: string | null;
  missions_to_next_level?: number | null;
}

interface Transaction {
  _id: string;
  amount: number;
  commission: number;
  artisan_earning: number;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an amount with French locale and FCFA suffix. */
function formatFCFA(amount: number): string {
  return `${Number(amount).toLocaleString('fr-FR')} FCFA`;
}

/** Format date consistently across all screens. */
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

/** Format short date for transaction list. */
function formatShortDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isValid(d)) return '';
    return format(d, 'dd MMM', { locale: fr });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Shimmer placeholder
// ---------------------------------------------------------------------------

function ShimmerLoading() {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
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
  }, [shimmerAnim]);

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
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Portefeuille</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Commission card shimmer */}
        <View style={[styles.commissionCard, { minHeight: 200 }]}>
          <Animated.View style={barStyle('40%', 14, SPACING.sm)} />
          <Animated.View style={barStyle('60%', 32, SPACING.xl)} />
          <View style={styles.commissionMeta}>
            <View style={styles.metaItem}>
              <Animated.View style={barStyle('70%', 10, 4)} />
              <Animated.View style={barStyle('50%', 14)} />
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Animated.View style={barStyle('70%', 10, 4)} />
              <Animated.View style={barStyle('50%', 14)} />
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Animated.View style={barStyle('70%', 10, 4)} />
              <Animated.View style={barStyle('50%', 14)} />
            </View>
          </View>
        </View>
        {/* Credit card shimmer */}
        <View style={styles.section}>
          <Animated.View style={barStyle('40%', 18, SPACING.md)} />
          <View style={styles.creditStatusCard}>
            <Animated.View style={barStyle('100%', 6, SPACING.md)} />
            <Animated.View style={barStyle('70%', 13)} />
          </View>
        </View>
        {/* Level card shimmer */}
        <View style={styles.section}>
          <Animated.View style={barStyle('30%', 18, SPACING.md)} />
          <View style={[styles.levelCard, { minHeight: 160 }]}>
            <Animated.View style={[barStyle(64, 64), { borderRadius: 32, marginBottom: SPACING.md }]} />
            <Animated.View style={barStyle('40%', 22)} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Wallet() {
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const [credit, setCredit] = useState<CreditStatus | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const payInProgressRef = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      setFetchError(null);
      const [creditRes, txRes] = await Promise.allSettled([
        api.get('/credit/status'),
        api.get('/credit/transactions'),
      ]);

      if (creditRes.status === 'fulfilled') {
        setCredit(creditRes.value.data);
      } else {
        console.error('Credit fetch failed:', creditRes.reason);
      }
      if (txRes.status === 'fulfilled') {
        const txData = txRes.value.data;
        setTransactions(Array.isArray(txData) ? txData : (txData?.transactions || []));
      } else {
        console.error('Transactions fetch failed:', txRes.reason);
      }

      // If both failed, show error to user
      if (creditRes.status === 'rejected' && txRes.status === 'rejected') {
        const reason = creditRes.reason;
        if (!reason?.response) {
          setFetchError('Verifiez votre connexion internet et tirez vers le bas pour reessayer.');
        } else {
          setFetchError('Impossible de charger les donnees du portefeuille. Tirez vers le bas pour reessayer.');
        }
      }
    } catch (error) {
      console.error('Wallet fetch error:', error);
      setFetchError('Une erreur est survenue. Tirez vers le bas pour reessayer.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, syncVersion]);

  // Fallback auto-refresh while wallet screen is focused (covers missed realtime events).
  useFocusEffect(
    useCallback(() => {
      fetchData();
      const interval = setInterval(fetchData, 20000);
      return () => clearInterval(interval);
    }, [fetchData]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchData();
  };

  const handlePayCommission = () => {
    if (!credit || credit.commission_due <= 0) {
      Alert.alert('Info', 'Aucune commission a regler.');
      return;
    }

    // Guard against double-trigger from rapid taps
    if (paying || payInProgressRef.current) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Payer la commission',
      `Montant: ${formatFCFA(credit.commission_due)}\n\nConfirmer le paiement via Mobile Money ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Payer',
          onPress: async () => {
            if (payInProgressRef.current) return;
            payInProgressRef.current = true;
            setPaying(true);
            try {
              const res = await api.post('/credit/pay', {
                amount: credit.commission_due,
                payment_method: 'mobile_money',
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Paiement reussi !', res.data?.message || 'Votre compte est debloque.');
              fetchData();
            } catch (error: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

              let title = 'Erreur de paiement';
              let message = 'Echec du paiement. Veuillez reessayer.';

              if (!error.response) {
                title = 'Probleme de connexion';
                message = 'Verifiez votre connexion internet et reessayez.';
              } else if (error.response.status === 408 || error.code === 'ECONNABORTED') {
                title = 'Delai depasse';
                message = 'Le paiement a pris trop de temps. Verifiez votre solde avant de reessayer.';
              } else if (error.response.status === 502) {
                title = 'Service indisponible';
                message = 'Le service de paiement est temporairement indisponible. Reessayez dans quelques minutes.';
              } else if (error.response?.data?.detail) {
                message = error.response.data.detail;
              }

              Alert.alert(title, message);
            } finally {
              setPaying(false);
              payInProgressRef.current = false;
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return <ShimmerLoading />;
  }

  const levelColor = LEVEL_COLORS[credit?.level || 'bronze'] || COLORS.primary;
  const creditProgress = credit ? credit.credit_remaining / credit.credit_max : 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Portefeuille</Text>
      </View>

      {fetchError && (
        <TouchableOpacity
          style={styles.errorBanner}
          onPress={onRefresh}
          activeOpacity={0.7}
        >
          <Ionicons name="alert-circle" size={18} color={COLORS.error} />
          <Text style={styles.errorBannerText}>{fetchError}</Text>
          <Ionicons name="refresh" size={16} color={COLORS.textLight} />
        </TouchableOpacity>
      )}

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.neutral500}
            colors={[COLORS.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Commission Card */}
        <View style={styles.commissionCard}>
          <Text style={styles.commissionLabel}>Commission due</Text>
          <Text style={styles.commissionAmount}>
            {formatFCFA(credit?.commission_due ?? 0)}
          </Text>

          <View style={styles.commissionMeta}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Par mission</Text>
              <Text style={styles.metaValue}>
                {credit?.commission_rate_percent || formatFCFA(credit?.commission_per_mission || 2000)}
              </Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Total gagne</Text>
              <Text style={styles.metaValue}>
                {formatFCFA(credit?.total_earned ?? 0)}
              </Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Total paye</Text>
              <Text style={styles.metaValue}>
                {formatFCFA(credit?.total_paid ?? 0)}
              </Text>
            </View>
          </View>

          {credit && credit.commission_due > 0 && (
            <TouchableOpacity
              style={[styles.payButton, paying && styles.payButtonDisabled]}
              onPress={handlePayCommission}
              disabled={paying}
              activeOpacity={0.8}
            >
              {paying ? (
                <View style={styles.payButtonContent}>
                  <ActivityIndicator size="small" color={COLORS.white} />
                  <Text style={styles.payButtonText}>Paiement en cours...</Text>
                </View>
              ) : (
                <View style={styles.payButtonContent}>
                  <Ionicons name="phone-portrait-outline" size={20} color={COLORS.white} />
                  <Text style={styles.payButtonText}>Payer via Mobile Money</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Credit Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Credits disponibles</Text>
          <View style={styles.creditStatusCard}>
            <View style={styles.creditRow}>
              <View style={styles.creditVisual}>
                {Array.from({ length: credit?.credit_max || 3 }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.creditDot,
                      {
                        backgroundColor:
                          i < (credit?.credit_remaining || 0) ? COLORS.success : COLORS.border,
                      },
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.creditCount}>
                {credit?.credit_remaining ?? 0} / {credit?.credit_max ?? 3}
              </Text>
            </View>

            <View style={styles.creditProgressBar}>
              <View
                style={[
                  styles.creditProgressFill,
                  {
                    width: `${creditProgress * 100}%`,
                    backgroundColor: creditProgress > 0.3 ? COLORS.success : COLORS.error,
                  },
                ]}
              />
            </View>

            <Text style={styles.creditExplain}>
              {credit?.can_accept_mission
                ? 'Vous pouvez accepter des missions'
                : 'Reglez votre commission pour accepter des missions'}
            </Text>
          </View>
        </View>

        {/* Level Card */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Niveau</Text>
          <View style={styles.levelCard}>
            <View style={[styles.levelIconCircle, { backgroundColor: levelColor + '18' }]}>
              <Ionicons name="trophy" size={28} color={levelColor} />
            </View>
            <Text style={[styles.levelName, { color: levelColor }]}>
              {credit?.level_name || 'Plan fixe'}
            </Text>

            <View style={styles.benefitsList}>
              {(LEVEL_BENEFITS[credit?.level || 'bronze'] || []).map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                  <Text style={styles.benefitText}>{b}</Text>
                </View>
              ))}
            </View>

            {credit?.next_level && (
              <View style={styles.nextLevelSection}>
                <View style={styles.nextLevelBar}>
                  <View
                    style={[
                      styles.nextLevelFill,
                      {
                        width: credit.missions_to_next_level
                          ? `${Math.max(5, 100 - (credit.missions_to_next_level / 20) * 100)}%`
                          : '100%',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.nextLevelText}>
                  {credit.missions_to_next_level} missions pour {credit.next_level_name}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Transactions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Historique</Text>
          {transactions.length === 0 ? (
            <View style={styles.emptyTx}>
              <Ionicons name="receipt-outline" size={48} color={COLORS.neutral400} />
              <Text style={styles.emptyTxText}>
                Aucune transaction pour le moment
              </Text>
              <Text style={styles.emptyTxSubtext}>
                Vos gains apparaitront ici.
              </Text>
            </View>
          ) : (
            transactions.slice(0, 10).map((tx) => (
              <View key={tx._id} style={styles.txCard}>
                <View style={styles.txIcon}>
                  <Ionicons name="receipt" size={20} color={COLORS.primary} />
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txAmount}>
                    +{formatFCFA(tx.artisan_earning || 0)}
                  </Text>
                  <Text style={styles.txCommission}>
                    Commission: {formatFCFA(tx.commission || 0)}
                  </Text>
                </View>
                <Text style={styles.txDate}>
                  {formatShortDate(tx.created_at)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
    backgroundColor: COLORS.neutral50,
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
  scrollContent: {
    paddingBottom: 120,
  },

  // ---- Commission Card ----
  commissionCard: {
    backgroundColor: COLORS.dark,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    borderRadius: RADII.xl,
    padding: SPACING['2xl'],
    ...SHADOWS.lg,
  },
  commissionLabel: {
    fontSize: 14,
    color: COLORS.neutral400,
  },
  commissionAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
    marginTop: SPACING.xs,
  },
  commissionMeta: {
    flexDirection: 'row',
    marginTop: SPACING.xl,
    alignItems: 'center',
  },
  metaItem: {
    flex: 1,
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 11,
    color: COLORS.neutral400,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: 2,
  },
  metaDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.neutral700,
  },
  payButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.lg - 2,
    borderRadius: RADII.md,
    marginTop: SPACING.xl,
    minHeight: 48,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  payButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },

  // ---- Sections ----
  section: {
    marginTop: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: SPACING.md,
  },

  // ---- Credit Status ----
  creditStatusCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  creditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  creditVisual: {
    flexDirection: 'row',
    gap: 6,
  },
  creditDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  creditCount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  creditProgressBar: {
    height: 6,
    backgroundColor: COLORS.neutral100,
    borderRadius: 3,
    marginBottom: SPACING.md,
  },
  creditProgressFill: {
    height: 6,
    borderRadius: 3,
  },
  creditExplain: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 18,
  },

  // ---- Level Card ----
  levelCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING['2xl'],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  levelIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  levelName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: SPACING.lg,
  },
  benefitsList: {
    width: '100%',
    gap: SPACING.sm + 2,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  benefitText: {
    fontSize: 14,
    color: COLORS.dark,
    lineHeight: 20,
  },
  nextLevelSection: {
    width: '100%',
    marginTop: SPACING.xl,
    paddingTop: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  nextLevelBar: {
    height: 6,
    backgroundColor: COLORS.neutral100,
    borderRadius: 3,
    marginBottom: SPACING.sm,
  },
  nextLevelFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  nextLevelText: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
  },

  // ---- Transactions ----
  emptyTx: {
    alignItems: 'center',
    padding: SPACING['3xl'],
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  emptyTxText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  emptyTxSubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADII.md,
    padding: SPACING.lg - 2,
    marginBottom: SPACING.sm,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  txIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.neutral100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.success,
  },
  txCommission: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  txDate: {
    fontSize: 12,
    color: COLORS.textLight,
  },

  // ---- Error banner ----
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.error + '12',
    gap: SPACING.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.error,
    lineHeight: 18,
  },

  // ---- Bottom spacer ----
  bottomSpacer: {
    height: SPACING['3xl'],
  },
});
