import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SERVICES_DATA, SERVICE_CATEGORIES } from '../src/config/constants';

interface Service {
  id: string;
  name: string;
  price: string;
  unit: string;
  category?: string;
}

const { width } = Dimensions.get('window');

export default function SelectService() {
  const router = useRouter();
  const { categoryId, categoryName } = useLocalSearchParams();

  const services: Service[] = SERVICES_DATA[categoryId as keyof typeof SERVICES_DATA] || [];

  // Find current category to get its specific color styling
  const currentCategory = SERVICE_CATEGORIES.find(c => c.id === categoryId);
  const themeColor = currentCategory?.color || COLORS.primary;

  // Group services by category if present
  const groupedServices = useMemo(() => {
    const groups: { [key: string]: Service[] } = {};
    const hasCategories = services.some(s => s.category);

    if (!hasCategories) {
      return { 'General': services };
    }

    services.forEach(service => {
      const cat = service.category || 'Autres';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(service);
    });

    return groups;
  }, [services]);

  const handleServiceSelect = (service: Service) => {
    router.push({
      pathname: '/select-artisan',
      params: {
        serviceId: service.id,
        serviceName: service.name,
        servicePrice: service.price,
        categoryId: categoryId,
      }
    });
  };

  const getServiceIcon = (serviceName: string): any => {
    const name = serviceName.toLowerCase();
    // Ménage
    if (name.includes('vitres')) return 'layers-outline';
    if (name.includes('balcon')) return 'leaf-outline';
    if (name.includes('événement')) return 'wine-outline';
    if (name.includes('pièce')) return 'home-outline';
    if (name.includes('nettoyage')) return 'sparkles-outline';

    // Plomberie
    if (name.includes('robinet')) return 'water-outline';
    if (name.includes('chasse')) return 'ellipse-outline';
    if (name.includes('wc')) return 'trash-bin-outline'; // Or similar
    if (name.includes('débouchage')) return 'sync-outline';
    if (name.includes('douchette')) return 'rainy-outline';
    if (name.includes('machine')) return 'cog-outline';

    // Electricité
    if (name.includes('ampoule')) return 'bulb-outline';
    if (name.includes('prise')) return 'power-outline';
    if (name.includes('interrupteur')) return 'toggle-outline';
    if (name.includes('ventilateur')) return 'aperture-outline';
    if (name.includes('tv')) return 'tv-outline';
    if (name.includes('frigo') || name.includes('congélateur')) return 'cube-outline';
    if (name.includes('micro-ondes')) return 'restaurant-outline';
    if (name.includes('clim')) return 'snow-outline';

    // Bricolage
    if (name.includes('tringle')) return 'resize-outline';
    if (name.includes('étagère')) return 'list-outline';
    if (name.includes('meuble')) return 'file-tray-stacked-outline';
    if (name.includes('tableau')) return 'image-outline';

    // Mécanique
    if (name.includes('roue')) return 'disc-outline';
    if (name.includes('batterie')) return 'battery-charging-outline';
    if (name.includes('essuie')) return 'wifi-outline'; // Looks like wiper
    if (name.includes('pneus')) return 'radio-button-on-outline';
    if (name.includes('carburant')) return 'water-outline';

    // Default
    return 'construct-outline';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{categoryName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introContainer}>
          <Text style={styles.title}>Précisez votre demande</Text>
          <Text style={styles.subtitle}>Sélectionnez l'option qui correspond le mieux à votre besoin.</Text>
        </View>

        {Object.entries(groupedServices).map(([groupName, groupItems], groupIndex) => (
          <View key={groupName} style={styles.groupContainer}>
            {groupName !== 'General' && (
              <Text style={styles.groupTitle}>{groupName}</Text>
            )}

            {groupItems.map((service, index) => (
              <TouchableOpacity
                key={service.id}
                style={styles.card}
                onPress={() => handleServiceSelect(service)}
                activeOpacity={0.7}
              >
                <View style={[styles.cardIconContainer, { backgroundColor: themeColor + '15' }]}>
                  <Ionicons
                    name={getServiceIcon(service.name)}
                    size={24}
                    color={themeColor}
                  />
                </View>

                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{service.name}</Text>
                  {service.price ? (
                    <View style={styles.priceContainer}>
                      <Text style={[styles.priceText, { color: themeColor }]}>{service.price} {service.unit}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.cardAction}>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ))}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  introContainer: {
    marginTop: 20,
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.dark,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    lineHeight: 22,
  },
  groupContainer: {
    marginBottom: 24,
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 16,
    marginLeft: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
  },
  cardIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 4,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceText: {
    fontSize: 14,
    fontWeight: '700',
  },
  cardAction: {
    paddingLeft: 12,
  },
});