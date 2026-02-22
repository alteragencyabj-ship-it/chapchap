import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../src/services/api';
import { COLORS, SHADOWS, RADII, SPACING, TYPOGRAPHY } from '../src/config/constants';
import { format, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

interface BlockedArtisan {
  artisan_id: string;
  artisan_name: string;
  artisan_phone: string;
  commission_due: number;
  blocked_since: string | null;
  is_blocked: boolean;
}

function formatFCFA(amount: number): string {
  return `${Number(amount).toLocaleString('fr-FR')} FCFA`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isValid(d)) return '';
    return format(d, 'dd MMM yyyy', { locale: fr });
  } catch {
    return '';
  }
}

export default function AdminSettle() {
  const router = useRouter();
  const [artisans, setArtisans] = useState<BlockedArtisan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);

  const fetchBlocked = useCallback(async () => {
    try {
      const res = await api.get('/admin/artisans/blocked');
      setArtisans(Array.isArray(res.data) ? res.data : []);
    } catch (error: any) {
      console.error('Fetch blocked artisans error:', error);
      if (error.response?.status === 403) {
        Alert.alert('Acces refuse', 'Vous n\'avez pas les permissions necessaires.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchBlocked();
    }, [fetchBlocked]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchBlocked();
  };

  const handleSettle = (artisan: BlockedArtisan) => {
    if (settlingId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Regulariser les commissions',
      `Artisan: ${artisan.artisan_name}\nCommission due: ${formatFCFA(artisan.commission_due)}\n\nCette action remet la commission a 0 et debloque le compte.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            setSettlingId(artisan.artisan_id);
            try {
              const res = await api.post(
                `/admin/artisans/${artisan.artisan_id}/settle-commissions`,
                { note: 'Regularisation admin depuis l\'app' },
              );
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              const settled = res.data?.result;
              if (settled?.already_settled) {
                Alert.alert('Deja regularise', 'Cet artisan n\'a aucune commission due.');
              } else {
                Alert.alert(
                  'Regularisation effectuee',
                  `${formatFCFA(settled?.amount_settled || 0)} regularises pour ${artisan.artisan_name}.`,
                );
              }
              fetchBlocked();
            } catch (error: any) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              let message = 'Echec de la regularisation. Veuillez reessayer.';
              if (error.response?.data?.detail) {
                message = error.response.data.detail;
              } else if (!error.response) {
                message = 'Verifiez votre connexion internet.';
              }
              Alert.alert('Erreur', message);
            } finally {
              setSettlingId(null);
            }
          },
        },
      ],
    );
  };

  const renderArtisan = ({ item }: { item: BlockedArtisan }) => {
    const isSettling = settlingId === item.artisan_id;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={24} color={COLORS.white} />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.artisanName}>{item.artisan_name}</Text>
            <Text style={styles.artisanPhone}>{item.artisan_phone}</Text>
          </View>
          <View style={styles.blockedBadge}>
            <Text style={styles.blockedBadgeText}>Bloque</Text>
          </View>
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Commission due</Text>
            <Text style={styles.detailValue}>{formatFCFA(item.commission_due)}</Text>
          </View>
          {item.blocked_since && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Bloque depuis</Text>
              <Text style={styles.detailDate}>{formatDate(item.blocked_since)}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.settleButton, isSettling && styles.settleButtonDisabled]}
          onPress={() => handleSettle(item)}
          disabled={isSettling}
          activeOpacity={0.8}
        >
          {isSettling ? (
            <View style={styles.settleButtonContent}>
              <ActivityIndicator size="small" color={COLORS.white} />
              <Text style={styles.settleButtonText}>Regularisation...</Text>
            </View>
          ) : (
            <View style={styles.settleButtonContent}>
              <Ionicons name="shield-checkmark" size={20} color={COLORS.white} />
              <Text style={styles.settleButtonText}>Regulariser</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Regularisation</Text>
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Regularisation</Text>
      </View>

      <FlatList
        data={artisans}
        keyExtractor={(item) => item.artisan_id}
        renderItem={renderArtisan}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.neutral500}
            colors={[COLORS.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle-outline" size={64} color={COLORS.success} />
            <Text style={styles.emptyTitle}>Aucun artisan bloque</Text>
            <Text style={styles.emptySubtext}>
              Tous les artisans sont a jour sur leurs commissions.
            </Text>
          </View>
        }
      />
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.dark,
    letterSpacing: -0.3,
  },
  listContent: {
    padding: SPACING.lg,
    paddingBottom: 120,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.xl,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  artisanName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.dark,
  },
  artisanPhone: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  blockedBadge: {
    backgroundColor: COLORS.error + '18',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADII.pill,
  },
  blockedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.error,
  },
  cardDetails: {
    backgroundColor: COLORS.neutral50,
    borderRadius: RADII.md,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.error,
  },
  detailDate: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.dark,
  },
  settleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.lg - 2,
    borderRadius: RADII.md,
    minHeight: 48,
  },
  settleButtonDisabled: {
    opacity: 0.6,
  },
  settleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  settleButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: SPACING['3xl'] * 2,
    gap: SPACING.md,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.dark,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingHorizontal: SPACING['2xl'],
  },
});
