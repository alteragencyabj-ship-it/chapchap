import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  SERVICES_DATA,
  SERVICE_CATEGORIES,
  SHADOWS,
  SPACING,
  RADII,
  TYPOGRAPHY,
} from '../src/config/constants';

interface Service {
  id: string;
  name: string;
  price: string;
  unit: string;
  category?: string;
}

export default function SelectService() {
  const router = useRouter();
  const { categoryId, categoryName } = useLocalSearchParams();

  const services = useMemo<Service[]>(
    () => SERVICES_DATA[categoryId as keyof typeof SERVICES_DATA] || [],
    [categoryId]
  );

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
    // Menage
    if (name.includes('vitres')) return 'layers-outline';
    if (name.includes('balcon')) return 'leaf-outline';
    if (name.includes('evenement') || name.includes('événement')) return 'wine-outline';
    if (name.includes('piece') || name.includes('pièce')) return 'home-outline';
    if (name.includes('nettoyage')) return 'sparkles-outline';

    // Plomberie
    if (name.includes('robinet')) return 'water-outline';
    if (name.includes('chasse')) return 'ellipse-outline';
    if (name.includes('wc')) return 'trash-bin-outline';
    if (name.includes('debouchage') || name.includes('débouchage')) return 'sync-outline';
    if (name.includes('douchette')) return 'rainy-outline';
    if (name.includes('machine')) return 'cog-outline';

    // Electricite
    if (name.includes('ampoule')) return 'bulb-outline';
    if (name.includes('prise')) return 'power-outline';
    if (name.includes('interrupteur')) return 'toggle-outline';
    if (name.includes('ventilateur')) return 'aperture-outline';
    if (name.includes('tv')) return 'tv-outline';
    if (name.includes('frigo') || name.includes('congelateur') || name.includes('congélateur')) return 'cube-outline';
    if (name.includes('micro-ondes')) return 'restaurant-outline';
    if (name.includes('clim')) return 'snow-outline';

    // Bricolage
    if (name.includes('tringle')) return 'resize-outline';
    if (name.includes('etagere') || name.includes('étagère')) return 'list-outline';
    if (name.includes('meuble')) return 'file-tray-stacked-outline';
    if (name.includes('tableau')) return 'image-outline';

    // Mecanique
    if (name.includes('roue')) return 'disc-outline';
    if (name.includes('batterie')) return 'battery-charging-outline';
    if (name.includes('essuie')) return 'wifi-outline';
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
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introContainer}>
          <Text style={styles.title}>Precisez votre demande</Text>
          <Text style={styles.subtitle}>Selectionnez l'option qui correspond le mieux a votre besoin.</Text>
        </View>

        {Object.entries(groupedServices).map(([groupName, groupItems]) => (
          <View key={groupName} style={styles.groupContainer}>
            {groupName !== 'General' && (
              <Text style={styles.groupTitle}>{groupName}</Text>
            )}

            {groupItems.map((service) => (
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
  scrollContent: {
    paddingHorizontal: SPACING['2xl'],
    paddingBottom: 40,
  },
  introContainer: {
    marginTop: SPACING.xl,
    marginBottom: SPACING['3xl'],
  },
  title: {
    ...TYPOGRAPHY.h1,
    letterSpacing: -0.5,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    lineHeight: 22,
  },
  groupContainer: {
    marginBottom: SPACING['2xl'],
  },
  groupTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
    marginBottom: SPACING.lg,
    marginLeft: SPACING.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADII.xl,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.neutral100,
    ...SHADOWS.sm,
  },
  cardIconContainer: {
    width: 48,
    height: 48,
    borderRadius: RADII.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.lg,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: SPACING.xs,
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
    paddingLeft: SPACING.md,
  },
});
