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
}

export default function SelectArtisan() {
  const router = useRouter();
  const { serviceId, serviceName, servicePrice, categoryId } = useLocalSearchParams();
  
  const [artisans, setArtisans] = useState<Artisan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchArtisans();
  }, []);

  const fetchArtisans = async () => {
    try {
      // Fetch artisans filtered by service category
      const response = await api.get('/artisans', {
        params: {
          specialty: categoryId,
          verified_only: false,
        }
      });
      
      // Sort artisans: disponible > rating > missions > response time
      const sorted = response.data.sort((a: Artisan, b: Artisan) => {
        // Priority 1: Disponible first
        if (a.statut === 'disponible' && b.statut !== 'disponible') return -1;
        if (a.statut !== 'disponible' && b.statut === 'disponible') return 1;
        
        // Priority 2: Rating
        if (b.average_rating !== a.average_rating) {
          return b.average_rating - a.average_rating;
        }
        
        // Priority 3: Number of missions
        if (b.total_missions !== a.total_missions) {
          return b.total_missions - a.total_missions;
        }
        
        // Priority 4: Response rate
        return (b.taux_reponse || 0) - (a.taux_reponse || 0);
      });
      
      setArtisans(sorted);
    } catch (error) {
      console.error('Failed to fetch artisans:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (statut?: string) => {
    switch (statut) {
      case 'disponible': return COLORS.secondary;
      case 'occupe': return COLORS.warning;
      case 'hors-ligne': return COLORS.textLight;
      default: return COLORS.textLight;
    }
  };

  const getStatusText = (statut?: string) => {
    switch (statut) {
      case 'disponible': return 'Disponible';
      case 'occupe': return 'Occupé';
      case 'hors-ligne': return 'Hors-ligne';
      default: return 'Indisponible';
    }
  };

  const renderArtisan = ({ item }: { item: Artisan }) => (
    <TouchableOpacity
      style={styles.artisanCard}
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
      activeOpacity={0.7}
    >
      <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.statut) + '20' }]}>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.statut) }]} />
      </View>
      
      <View style={styles.artisanAvatar}>
        <Ionicons name="person" size={28} color={COLORS.primary} />
      </View>
      
      <Text style={styles.artisanName} numberOfLines={1}>{item.name}</Text>
      
      <View style={styles.ratingContainer}>
        <Ionicons name="star" size={14} color={COLORS.warning} />
        <Text style={styles.ratingText}>
          {item.average_rating?.toFixed(1) || '0.0'}
        </Text>
      </View>
      
      <Text style={styles.missionsText} numberOfLines={1}>
        {item.total_missions || 0} mission{(item.total_missions || 0) > 1 ? 's' : ''}
      </Text>
      
      {item.quartier && (
        <Text style={styles.locationText} numberOfLines={1}>
          {item.quartier}
        </Text>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 16 }}>
          <Text style={styles.headerTitle}>Artisans disponibles</Text>
          <Text style={styles.headerSubtitle}>{serviceName}</Text>
        </View>
      </View>

      <View style={styles.priceContainer}>
        <Text style={styles.priceLabel}>Prix du service :</Text>
        <Text style={styles.priceValue}>{servicePrice} FCFA</Text>
      </View>

      {artisans.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={80} color={COLORS.textLight} />
          <Text style={styles.emptyText}>Aucun artisan disponible</Text>
          <Text style={styles.emptySubtext}>
            Aucun artisan qualifié n'est disponible pour ce service actuellement
          </Text>
        </View>
      ) : (
        <FlatList
          data={artisans}
          renderItem={renderArtisan}
          keyExtractor={(item) => item._id}
          numColumns={3}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.columnWrapper}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 5,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 2,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  priceLabel: {
    fontSize: 14,
    color: COLORS.dark,
  },
  priceValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.secondary,
  },
  listContent: {
    padding: 12,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  artisanCard: {
    width: '31.5%',
    aspectRatio: 0.85,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  artisanAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${COLORS.primary}15`,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  artisanName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.dark,
    textAlign: 'center',
    marginTop: 8,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.dark,
  },
  missionsText: {
    fontSize: 10,
    color: COLORS.textLight,
    marginTop: 2,
  },
  locationText: {
    fontSize: 10,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});