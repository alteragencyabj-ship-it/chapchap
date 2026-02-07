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
  Alert,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/services/api';
import { COLORS } from '../../src/config/constants';

const LEVEL_COLORS: Record<string, string> = {
  bronze: COLORS.iconSand,
  silver: COLORS.iconSteel,
  gold: COLORS.iconSage,
  diamond: COLORS.iconIce,
};

const LEVEL_BENEFITS: Record<string, string[]> = {
  bronze: ['3 credits par cycle', '15% commission', 'Support standard'],
  silver: ['5 credits par cycle', '12% commission', 'Support prioritaire'],
  gold: ['10 credits par cycle', '10% commission', 'Badge "Or" visible'],
  diamond: ['15 credits par cycle', '8% commission', 'Badge "Diamant" + promo'],
};

interface CreditStatus {
  level: string;
  level_name: string;
  credit_remaining: number;
  credit_max: number;
  commission_due: number;
  commission_rate: number;
  commission_rate_percent: string;
  is_blocked: boolean;
  can_accept_mission: boolean;
  total_earned: number;
  total_paid: number;
  next_level: string | null;
  next_level_name: string | null;
  missions_to_next_level: number | null;
}

interface Transaction {
  _id: string;
  amount: number;
  commission: number;
  artisan_earning: number;
  status: string;
  created_at: string;
}

export default function Wallet() {
  const [credit, setCredit] = useState<CreditStatus | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [creditRes, txRes] = await Promise.allSettled([
        api.get('/credit/status'),
        api.get('/credit/transactions'),
      ]);

      if (creditRes.status === 'fulfilled') {
        setCredit(creditRes.value.data);
      }
      if (txRes.status === 'fulfilled') {
        setTransactions(txRes.value.data?.transactions || txRes.value.data || []);
      }
    } catch (error) {
      console.error('Wallet fetch error:', error);
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

  const handlePayCommission = () => {
    if (!credit || credit.commission_due <= 0) {
      Alert.alert('Info', 'Aucune commission a regler.');
      return;
    }

    Alert.alert(
      'Payer la commission',
      `Montant: ${credit.commission_due.toLocaleString('fr-FR')} FCFA\n\nSimulation Mobile Money - Confirmer le paiement ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Payer',
          onPress: async () => {
            setPaying(true);
            try {
              const res = await api.post('/credit/pay', {
                amount: credit.commission_due,
                payment_method: 'mobile_money',
              });
              Alert.alert('Paiement reussi !', res.data.message || 'Votre compte est debloque.');
              fetchData();
            } catch (error: any) {
              Alert.alert(
                'Erreur',
                error.response?.data?.detail || 'Echec du paiement. Reessayez.'
              );
            } finally {
              setPaying(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const levelColor = LEVEL_COLORS[credit?.level || 'bronze'] || COLORS.primary;
  const creditProgress = credit ? credit.credit_remaining / credit.credit_max : 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Portefeuille</Text>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Commission Card */}
        <View style={styles.commissionCard}>
          <Text style={styles.commissionLabel}>Commission due</Text>
          <Text style={styles.commissionAmount}>
            {(credit?.commission_due ?? 0).toLocaleString('fr-FR')} FCFA
          </Text>

          <View style={styles.commissionMeta}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Taux</Text>
              <Text style={styles.metaValue}>{credit?.commission_rate_percent || '15%'}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Total gagne</Text>
              <Text style={styles.metaValue}>
                {((credit?.total_earned ?? 0) / 1000).toFixed(0)}k F
              </Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Total paye</Text>
              <Text style={styles.metaValue}>
                {((credit?.total_paid ?? 0) / 1000).toFixed(0)}k F
              </Text>
            </View>
          </View>

          {credit && credit.commission_due > 0 && (
            <TouchableOpacity
              style={[styles.payButton, paying && styles.payButtonDisabled]}
              onPress={handlePayCommission}
              disabled={paying}
            >
              {paying ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="phone-portrait-outline" size={20} color={COLORS.white} />
                  <Text style={styles.payButtonText}>Payer via Mobile Money</Text>
                </>
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
                          i < (credit?.credit_remaining || 0) ? COLORS.secondary : COLORS.border,
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
                    backgroundColor: creditProgress > 0.3 ? COLORS.secondary : COLORS.danger,
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
            <View style={[styles.levelIconCircle, { backgroundColor: levelColor + '20' }]}>
              <Ionicons name="trophy" size={28} color={levelColor} />
            </View>
            <Text style={[styles.levelName, { color: levelColor }]}>
              {credit?.level_name || 'Bronze'}
            </Text>

            <View style={styles.benefitsList}>
              {(LEVEL_BENEFITS[credit?.level || 'bronze'] || []).map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.secondary} />
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
              <Ionicons name="receipt-outline" size={40} color={COLORS.textLight} />
              <Text style={styles.emptyTxText}>Aucune transaction</Text>
            </View>
          ) : (
            transactions.slice(0, 10).map((tx) => (
              <View key={tx._id} style={styles.txCard}>
                <View style={styles.txIcon}>
                  <Ionicons name="receipt" size={18} color={COLORS.primary} />
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txAmount}>
                    +{tx.artisan_earning?.toLocaleString('fr-FR') || '0'} FCFA
                  </Text>
                  <Text style={styles.txCommission}>
                    Commission: {tx.commission?.toLocaleString('fr-FR') || '0'} F
                  </Text>
                </View>
                <Text style={styles.txDate}>
                  {new Date(tx.created_at).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: 'short',
                  })}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 32 }} />
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
    padding: 20,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  commissionCard: {
    backgroundColor: COLORS.dark,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    padding: 24,
  },
  commissionLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  commissionAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
    marginTop: 4,
  },
  commissionMeta: {
    flexDirection: 'row',
    marginTop: 20,
    alignItems: 'center',
  },
  metaItem: {
    flex: 1,
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 11,
    color: COLORS.textLight,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: 2,
  },
  metaDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.border,
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 20,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 12,
  },
  creditStatusCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
  },
  creditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
    backgroundColor: COLORS.light,
    borderRadius: 3,
    marginBottom: 12,
  },
  creditProgressFill: {
    height: 6,
    borderRadius: 3,
  },
  creditExplain: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  levelCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  levelIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  levelName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  benefitsList: {
    width: '100%',
    gap: 10,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  benefitText: {
    fontSize: 14,
    color: COLORS.dark,
  },
  nextLevelSection: {
    width: '100%',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  nextLevelBar: {
    height: 6,
    backgroundColor: COLORS.light,
    borderRadius: 3,
    marginBottom: 8,
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
  emptyTx: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: COLORS.white,
    borderRadius: 16,
  },
  emptyTxText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.secondary,
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
});
