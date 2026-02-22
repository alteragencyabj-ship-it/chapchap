import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/services/api';
import { COLORS, STATUS_COLORS, STATUS_LABELS, SHADOWS, RADII, SPACING } from '../../src/config/constants';
import { useSyncStore } from '../../src/store/syncStore';
import { format, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Request {
  _id: string;
  service_type: string;
  service_name?: string;
  description: string;
  status: string;
  created_at: string;
  address: string;
  budget?: number;
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

/** Return a human-readable relative time string in French. */
function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
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
    <View style={[styles.requestCard, { overflow: 'hidden' }]}>
      <View style={styles.requestHeader}>
        <Animated.View style={[barStyle(44, 44), { borderRadius: 22 }]} />
        <View style={styles.shimmerTextCol}>
          <Animated.View style={barStyle('60%', 14)} />
          <Animated.View style={barStyle('40%', 10)} />
        </View>
        <Animated.View style={barStyle(64, 24, 0)} />
      </View>
      <Animated.View style={barStyle('90%', 12, 6)} />
      <Animated.View style={barStyle('70%', 12, SPACING.sm)} />
      <View style={styles.requestFooter}>
        <Animated.View style={barStyle(80, 10)} />
        <Animated.View style={barStyle(60, 10)} />
      </View>
    </View>
  );
}

function ShimmerLoading() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mes Demandes</Text>
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

export default function MyRequests() {
  const router = useRouter();
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const fetchRequests = useCallback(async () => {
    try {
      setFetchError(false);
      const response = await api.get('/requests');
      setRequests(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch requests:', error);
      setFetchError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests, syncVersion]);

  // Re-fetch data when screen comes into focus (e.g. returning from create-request)
  useFocusEffect(
    useCallback(() => {
      fetchRequests();
    }, [fetchRequests])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchRequests();
  };

  const getStatusColor = (status: string) => STATUS_COLORS[status] || COLORS.textLight;
  const getStatusText = (status: string) => STATUS_LABELS[status] || status;

  const renderRequest = ({ item }: { item: Request }) => (
    <TouchableOpacity
      style={styles.requestCard}
      activeOpacity={0.7}
      onPress={() => router.push({
        pathname: '/request-details',
        params: { requestId: item._id }
      })}
    >
      <View style={styles.requestHeader}>
        <View style={styles.requestIcon}>
          <Ionicons name="construct" size={22} color={COLORS.primary} />
        </View>
        <View style={styles.flexOne}>
          <Text style={styles.requestService} numberOfLines={1}>
            {item.service_name || item.service_type}
          </Text>
          <Text style={styles.requestAddress} numberOfLines={1}>
            {item.address}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '18' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {getStatusText(item.status)}
          </Text>
        </View>
      </View>

      <Text style={styles.requestDescription} numberOfLines={2}>
        {item.description}
      </Text>

      {item.budget ? (
        <View style={styles.budgetRow}>
          <Ionicons name="cash-outline" size={16} color={COLORS.dark} />
          <Text style={styles.budgetAmount}>
            {formatFCFA(item.budget)}
          </Text>
        </View>
      ) : null}

      <View style={styles.requestFooter}>
        <Text style={styles.requestDate}>
          {formatDate(item.created_at)}
        </Text>
        <Text style={styles.requestElapsed}>
          {relativeTime(item.created_at)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return <ShimmerLoading />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mes Demandes</Text>
      </View>

      {fetchError && requests.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neutral500} colors={[COLORS.primary]} />
          }
        >
          <Ionicons name="cloud-offline-outline" size={64} color={COLORS.neutral400} />
          <Text style={styles.emptyText}>Connexion impossible</Text>
          <Text style={styles.emptySubtext}>
            Impossible de charger vos demandes. Verifiez votre connexion et tirez vers le bas pour reessayer.
          </Text>
        </ScrollView>
      ) : requests.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neutral500} colors={[COLORS.primary]} />
          }
        >
          <Ionicons name="document-text-outline" size={64} color={COLORS.neutral400} />
          <Text style={styles.emptyText}>Aucune demande pour le moment</Text>
          <Text style={styles.emptySubtext}>
            Trouvez un artisan qualifie pres de chez vous. Votre premiere demande ne prend que quelques minutes !
          </Text>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/create-request')}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={20} color={COLORS.white} />
            <Text style={styles.createButtonText}>Creer une demande</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={requests}
          renderItem={renderRequest}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
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
  listContent: {
    padding: SPACING.lg,
    paddingBottom: 120,
  },
  requestCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm + 2,
  },
  requestIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.neutral100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flexOne: {
    flex: 1,
  },
  shimmerTextCol: {
    flex: 1,
    gap: 6,
  },
  requestService: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
    textTransform: 'capitalize',
  },
  requestAddress: {
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
  requestDescription: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: SPACING.sm,
    lineHeight: 20,
  },
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
  requestFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  requestDate: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  requestElapsed: {
    fontSize: 12,
    color: COLORS.neutral500,
    fontStyle: 'italic',
  },
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
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING['2xl'],
    paddingVertical: SPACING.lg - 2,
    borderRadius: RADII.md,
    marginTop: SPACING['2xl'],
    minHeight: 48,
  },
  createButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
