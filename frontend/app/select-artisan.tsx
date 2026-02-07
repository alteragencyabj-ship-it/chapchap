import React, { useEffect, useState } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/services/api';
import { COLORS } from '../src/config/constants';

interface Artisan {
  _id: string;
  name: string;
  specialties: string[];
  average_rating: number;
  total_missions: number;
  taux_reponse?: number;
  delai_moyen_reponse?: string;
  quartier?: string;
  city?: string;
  statut?: string;
  distance?: number;
  is_verified?: boolean;
}

export default function SelectArtisan() {
  const router = useRouter();
  const { serviceId, serviceName, servicePrice, categoryId } = useLocalSearchParams();

  const [artisans, setArtisans] = useState<Artisan[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'recommended' | 'nearest' | 'fastest'>('recommended');

  useEffect(() => {
    fetchArtisans();
  }, []);

  const fetchArtisans = async () => {
    try {
      const response = await api.get('/artisans', {
        params: {
          specialty: categoryId,
          verified_only: false,
        }
      });

      const data = response.data || [];
      // Basic sort initially
      setArtisans(data);
    } catch (error) {
      console.error('Failed to fetch artisans:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSortedArtisans = () => {
    let sorted = [...artisans];
    if (filter === 'nearest') {
      // Mock sort as distance might be missing
      sorted.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    } else if (filter === 'fastest') {
      sorted.sort((a, b) => (b.taux_reponse || 0) - (a.taux_reponse || 0));
    } else {
      // Recommended: Rating + Missions
      sorted.sort((a, b) => b.average_rating - a.average_rating || b.total_missions - a.total_missions);
    }
    return sorted;
  };

  const renderArtisan = ({ item }: { item: Artisan }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({
        pathname: '/checkout',
        params: {
          artisanId: item._id,
          artisanName: item.name,
          serviceId,
          serviceName,
          servicePrice,
          categoryId,
        }
      })}
      activeOpacity={0.9}
    >
      <View style={styles.cardHeader}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{item.name.charAt(0)}</Text>
          </View>
          {item.is_verified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.blue} />
            </View>
          )}
        </View>

        <View style={styles.cardInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{item.name}</Text>
            <View style={[styles.statusPill, item.statut === 'disponible' ? styles.statusAvailable : styles.statusBusy]}>
              <View style={[styles.statusDot, { backgroundColor: item.statut === 'disponible' ? COLORS.success : COLORS.textLight }]} />
              <Text style={styles.statusText}>{item.statut === 'disponible' ? 'Dispo' : 'Occupé'}</Text>
            </View>
          </View>

          <Text style={styles.specialties}>{serviceName} • {item.quartier || 'Abidjan'}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="star" size={14} color={COLORS.warning} />
              <Text style={styles.statValue}>{item.average_rating?.toFixed(1)}</Text>
              <Text style={styles.statLabel}>({item.total_missions})</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="time-outline" size={14} color={COLORS.textLight} />
              <Text style={styles.statValue}>15 min</Text>
              <Text style={styles.statLabel}>délai</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.priceTag}>
          <Text style={styles.priceLabel}>A partir de</Text>
          <Text style={styles.priceAmount}>{servicePrice} F</Text>
        </View>
        <View style={styles.selectButton}>
          <Text style={styles.selectButtonText}>Choisir</Text>
          <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choisissez votre expert</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Filters */}
      <View style={styles.filterContainer}>
        {['recommended', 'nearest', 'fastest'].map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f as any)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'recommended' ? 'Recommandés' : f === 'nearest' ? 'Plus proches' : 'Plus rapides'}
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
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIcon}>
                <Ionicons name="search-outline" size={40} color={COLORS.textLight} />
              </View>
              <Text style={styles.emptyTitle}>Aucun artisan trouvé</Text>
              <Text style={styles.emptyText}>Essayez une autre catégorie ou revenez plus tard.</Text>
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
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.dark,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.dark,
    borderColor: COLORS.dark,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
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
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    marginBottom: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  avatarContainer: {
    marginRight: 16,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    flex: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusAvailable: {
    backgroundColor: COLORS.success + '15',
  },
  statusBusy: {
    backgroundColor: COLORS.textLight + '15',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.dark,
  },
  specialties: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.dark,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    marginLeft: 2,
  },
  statDivider: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  priceTag: {

  },
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
    backgroundColor: COLORS.dark, // Premium Black Button
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    gap: 8,
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
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    maxWidth: 240,
  },
});