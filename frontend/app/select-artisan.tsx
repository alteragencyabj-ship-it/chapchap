import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import api from '../src/services/api';
import { COLORS, SHADOWS, SPACING, RADII, TYPOGRAPHY } from '../src/config/constants';

interface Artisan {
  user_id: string;
  first_name: string;
  last_name: string;
  metier_principal?: string;
  photo?: string;
  photo_url?: string;
  avatar_url?: string;
  specialites: string[];
  note_moyenne: number;
  missions_completees: number;
  annees_experience?: number;
  score_profil: number;
  affiliated_clients_count: number;
  ranking_score: number;
  quartier?: string;
  ville?: string;
  distance_km?: number;
  badges?: string[];
  is_verified?: boolean;
}

export default function SelectArtisan() {
  const router = useRouter();
  const { serviceId, serviceName, servicePrice, categoryId } = useLocalSearchParams();

  const [artisans, setArtisans] = useState<Artisan[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'recommended' | 'nearest' | 'fastest'>('recommended');
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<string, boolean>>({});

  const serviceNameLabel = typeof serviceName === 'string' ? serviceName : '';
  const servicePriceLabel = typeof servicePrice === 'string' ? servicePrice : '';

  const getArtisanPhotoUri = useCallback((item: Artisan): string | null => {
    const raw = (item.photo || item.photo_url || item.avatar_url || '').trim();
    if (!raw) return null;

    if (
      raw.startsWith('http://')
      || raw.startsWith('https://')
      || raw.startsWith('data:image/')
    ) {
      return raw;
    }

    const compact = raw.replace(/\s+/g, '');
    const isLikelyBase64 = compact.length > 100 && /^[A-Za-z0-9+/=]+$/.test(compact);
    if (isLikelyBase64) {
      return `data:image/jpeg;base64,${compact}`;
    }

    return null;
  }, []);

  const markPhotoError = useCallback((artisanId: string) => {
    setImageLoadErrors((prev) => ({ ...prev, [artisanId]: true }));
  }, []);

  const fetchArtisans = useCallback(async () => {
    try {
      const serviceType = typeof categoryId === 'string' && categoryId
        ? categoryId
        : serviceNameLabel || undefined;

      const response = await api.get('/artisans/search', {
        params: {
          service_type: serviceType,
          verified_only: false,
          limit: 50,
          page: 1,
        },
      });

      const data = Array.isArray(response.data) ? response.data : [];
      const normalized: Artisan[] = data
        .map((raw: any) => {
          const badges = Array.isArray(raw?.badges)
            ? raw.badges.map((b: any) => String(b))
            : [];

          return {
            user_id: String(raw?.user_id || raw?._id || ''),
            first_name: String(raw?.first_name || ''),
            last_name: String(raw?.last_name || ''),
            metier_principal: raw?.metier_principal ? String(raw.metier_principal) : '',
            photo: raw?.photo ? String(raw.photo) : undefined,
            photo_url: raw?.photo_url ? String(raw.photo_url) : undefined,
            avatar_url: raw?.avatar_url ? String(raw.avatar_url) : undefined,
            specialites: Array.isArray(raw?.specialites)
              ? raw.specialites.map((s: any) => String(s))
              : [],
            note_moyenne: Number(raw?.note_moyenne || 0),
            missions_completees: Number(raw?.missions_completees || 0),
            annees_experience: raw?.annees_experience != null
              ? Number(raw.annees_experience)
              : undefined,
            score_profil: Number(raw?.score_profil || 0),
            affiliated_clients_count: Number(raw?.affiliated_clients_count || 0),
            ranking_score: Number(raw?.ranking_score || 0),
            quartier: raw?.quartier ? String(raw.quartier) : undefined,
            ville: raw?.ville ? String(raw.ville) : undefined,
            distance_km: raw?.distance_km != null ? Number(raw.distance_km) : undefined,
            badges,
            is_verified: badges.some((badge: string) => badge.toLowerCase() === 'verifie'),
          };
        })
        .filter((item) => Boolean(item.user_id));

      setArtisans(normalized);
    } catch (error) {
      console.error('Failed to fetch artisans:', error);
    } finally {
      setLoading(false);
    }
  }, [categoryId, serviceNameLabel]);

  useEffect(() => {
    fetchArtisans();
  }, [fetchArtisans]);

  const getSortedArtisans = () => {
    if (filter === 'recommended') {
      return artisans;
    }

    const sorted = [...artisans];
    if (filter === 'nearest') {
      sorted.sort(
        (a, b) => (a.distance_km ?? Number.MAX_SAFE_INTEGER) - (b.distance_km ?? Number.MAX_SAFE_INTEGER)
      );
      return sorted;
    }

    sorted.sort(
      (a, b) =>
        (b.annees_experience || 0) - (a.annees_experience || 0)
        || b.score_profil - a.score_profil
    );
    return sorted;
  };

  const renderArtisan = ({ item }: { item: Artisan }) => {
    const photoUri = getArtisanPhotoUri(item);
    const showPhoto = Boolean(photoUri) && !imageLoadErrors[item.user_id];
    const fullName = `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Artisan';
    const initial = fullName.charAt(0).toUpperCase();
    const locationLabel = item.quartier || item.ville || 'Abidjan';
    const tradeLabel = serviceNameLabel || item.metier_principal || 'Artisan';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          router.push({
            pathname: '/artisan-profile',
            params: {
              id: item.user_id,
              serviceId,
              serviceName,
              servicePrice,
              categoryId,
            },
          })
        }
        activeOpacity={0.9}
      >
        <View style={styles.cardHeader}>
          <View style={styles.avatarContainer}>
            {showPhoto ? (
              <Image
                source={{ uri: photoUri! }}
                style={styles.avatarImage}
                onError={() => markPhotoError(item.user_id)}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            {item.is_verified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.info} />
              </View>
            )}
          </View>

          <View style={styles.cardInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{fullName}</Text>
              <View style={styles.affiliationPill}>
                <Ionicons name="people-outline" size={12} color={COLORS.text} />
                <Text style={styles.affiliationText}>{item.affiliated_clients_count} affilies</Text>
              </View>
            </View>

            <Text style={styles.specialties} numberOfLines={1}>{tradeLabel} - {locationLabel}</Text>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Ionicons name="star" size={14} color={COLORS.warning} />
                <Text style={styles.statValue}>{item.note_moyenne.toFixed(1)}</Text>
                <Text style={styles.statLabel}>({item.missions_completees})</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Ionicons name="briefcase-outline" size={14} color={COLORS.textLight} />
                <Text style={styles.statValue}>{item.annees_experience || 0}</Text>
                <Text style={styles.statLabel}>ans</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Ionicons name="shield-checkmark-outline" size={14} color={COLORS.textLight} />
                <Text style={styles.statValue}>{Math.round(item.score_profil)}%</Text>
                <Text style={styles.statLabel}>profil</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.priceTag}>
            <Text style={styles.priceLabel}>A partir de</Text>
            <Text style={styles.priceAmount}>{servicePriceLabel} FCFA</Text>
          </View>
          <TouchableOpacity
            style={styles.selectButton}
            activeOpacity={0.8}
            onPress={() =>
              router.push({
                pathname: '/artisan-profile',
                params: {
                  id: item.user_id,
                  serviceId,
                  serviceName,
                  servicePrice,
                  categoryId,
                },
              })
            }
          >
            <Text style={styles.selectButtonText}>Choisir</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choisissez votre expert</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.filterContainer}>
        {(['recommended', 'nearest', 'fastest'] as const).map((currentFilter) => (
          <TouchableOpacity
            key={currentFilter}
            style={[styles.filterChip, filter === currentFilter && styles.filterChipActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setFilter(currentFilter);
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, filter === currentFilter && styles.filterTextActive]}>
              {currentFilter === 'recommended'
                ? 'Recommandes'
                : currentFilter === 'nearest'
                  ? 'Plus proches'
                  : 'Plus solides'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={getSortedArtisans()}
          renderItem={renderArtisan}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIcon}>
                <Ionicons name="search-outline" size={40} color={COLORS.textLight} />
              </View>
              <Text style={styles.emptyTitle}>Aucun artisan disponible</Text>
              <Text style={styles.emptyText}>
                Aucun artisan ne correspond a cette recherche pour le moment.
              </Text>
            </View>
          }
        />
      )}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.light,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
  },
  headerSpacer: {
    width: 44,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.xl,
    marginBottom: SPACING.xl,
    gap: SPACING.md,
  },
  filterChip: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: COLORS.dark,
    borderColor: COLORS.dark,
  },
  filterText: {
    ...TYPOGRAPHY.label,
    color: COLORS.textLight,
  },
  filterTextActive: {
    color: COLORS.white,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.xl,
    marginBottom: SPACING.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  cardHeader: {
    flexDirection: 'row',
    marginBottom: SPACING.lg,
  },
  avatarContainer: {
    marginRight: SPACING.lg,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.neutral100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.neutral100,
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: COLORS.white,
    borderRadius: 10,
  },
  cardInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    flex: 1,
  },
  affiliationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.neutral50,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    gap: SPACING.xs,
  },
  affiliationText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
  },
  specialties: {
    ...TYPOGRAPHY.label,
    color: COLORS.textLight,
    fontWeight: '400',
    marginBottom: SPACING.sm,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  statValue: {
    ...TYPOGRAPHY.label,
    color: COLORS.dark,
    fontWeight: '700',
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    marginLeft: 2,
  },
  statDivider: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  priceTag: {},
  priceLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  priceAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.dark,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: RADII.pill,
    gap: SPACING.sm,
    minHeight: 44,
  },
  selectButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.neutral100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h3,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
    textAlign: 'center',
    maxWidth: 260,
  },
});
