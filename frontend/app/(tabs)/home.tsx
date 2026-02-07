import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Dimensions,
  StatusBar,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { SERVICE_CATEGORIES, COLORS } from '../../src/config/constants';

const { width } = Dimensions.get('window');
const PADDING = 24;
const GAP = 16;
const CARD_WIDTH = (width - (PADDING * 2) - GAP) / 2;

// Animated Card Component for Staggered Effect
const AnimatedCard = ({ index, children }: { index: number, children: React.ReactNode }) => {
  const slideAnim = useRef(new Animated.Value(50)).current; // Start 50px down
  const fadeAnim = useRef(new Animated.Value(0)).current;   // Start transparent

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        delay: index * 100, // Stagger by 100ms
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        delay: index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
      }}
    >
      {children}
    </Animated.View>
  );
};

// Pulsing Icon Component
const PulsingIcon = () => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Ionicons name="flash" size={40} color={COLORS.white} />
    </Animated.View>
  );
};

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bonjour,';
    if (hour < 18) return 'Bon après-midi,';
    return 'Bonsoir,';
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.light} />

      {/* Header Section */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greetingTitle}>{getGreeting()}</Text>
          <Text style={styles.userName}>{user?.name?.split(' ')[0] || 'Client'}</Text>
        </View>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={() => router.push('/(tabs)/profile')}
          activeOpacity={0.8}
        >
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>
              {user?.name ? user.name.charAt(0).toUpperCase() : 'C'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Search Section */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={22} color={COLORS.textLight} />
            <TextInput
              style={styles.searchInput}
              placeholder="De quoi avez-vous besoin ?"
              placeholderTextColor={COLORS.textLight}
            />
            <View style={styles.filterButton}>
              <Ionicons name="options-outline" size={20} color={COLORS.dark} />
            </View>
          </View>
        </View>

        {/* Promo Banner with Pulse */}
        <AnimatedCard index={0}>
          <View style={styles.promoBanner}>
            <View style={styles.promoContent}>
              <Text style={styles.promoTitle}>Service Express</Text>
              <Text style={styles.promoText}>Un artisan chez vous en -30 min.</Text>
            </View>
            <View style={styles.promoIcon}>
              <PulsingIcon />
            </View>
          </View>
        </AnimatedCard>

        {/* Services Grid - Animated Stagger */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nos Services</Text>
          <View style={styles.grid}>
            {SERVICE_CATEGORIES.map((service: any, index: number) => (
              <AnimatedCard key={service.id} index={index + 1}>
                <TouchableOpacity
                  style={styles.card}
                  onPress={() => router.push({
                    pathname: '/select-service',
                    params: {
                      categoryId: service.id,
                      categoryName: service.name
                    }
                  })}
                  activeOpacity={0.95} // More solid feel
                >
                  <View style={styles.cardContent}>
                    {/* Watermark Icon */}
                    <View style={styles.watermarkContainer}>
                      <Ionicons
                        name={service.icon}
                        size={90}
                        color={service.color}
                        style={{ opacity: 0.08 }}
                      />
                    </View>

                    {/* Foreground Content */}
                    <View style={styles.cardHeader}>
                      <View style={[
                        styles.iconCircle,
                        { backgroundColor: service.color + '15' }
                      ]}>
                        <Ionicons
                          name={service.icon}
                          size={26}
                          color={service.color}
                        />
                      </View>
                    </View>

                    <View style={styles.cardFooter}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {service.name}
                      </Text>
                      <View style={styles.arrowContainer}>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              </AnimatedCard>
            ))}
          </View>
        </View>

        {/* How it works */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Comment ça marche ?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepsContainer}>
            {[1, 2, 3].map((step, index) => (
              <View key={step} style={styles.stepItem}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepNumber}>{step}</Text>
                  <View style={styles.stepIconParams}>
                    <Ionicons
                      name={index === 0 ? "search" : index === 1 ? "calendar" : "checkmark"}
                      size={24}
                      color={COLORS.primary}
                    />
                  </View>
                </View>
                <Text style={styles.stepText}>
                  {index === 0 ? "Choisissez" : index === 1 ? "Réservez" : "Profitez"}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.bottomSpacer} />
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: PADDING,
    paddingTop: 20,
    marginBottom: 24,
  },
  greetingTitle: {
    fontSize: 16,
    color: COLORS.textLight,
    fontWeight: '500',
    marginBottom: 4,
  },
  userName: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.dark,
    letterSpacing: -0.5,
  },
  profileButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.light,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  searchContainer: {
    paddingHorizontal: PADDING,
    marginBottom: 24,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 20,
    paddingHorizontal: 20,
    height: 60,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: COLORS.text,
    height: '100%',
    fontWeight: '500',
  },
  filterButton: {
    padding: 8,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    paddingLeft: 16,
  },
  promoBanner: {
    marginHorizontal: PADDING,
    marginBottom: 32,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  promoContent: {
    flex: 1,
    marginRight: 16,
  },
  promoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 6,
  },
  promoText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
  },
  promoIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.dark,
    marginBottom: 20,
    paddingHorizontal: PADDING,
    letterSpacing: -0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: PADDING,
  },
  card: {
    width: CARD_WIDTH,
    height: 170, // Uniform height
    borderRadius: 24,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 4,
    marginBottom: 8,
  },
  cardContent: {
    flex: 1,
    borderRadius: 24,
    padding: 16,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  watermarkContainer: {
    position: 'absolute',
    right: -25,
    bottom: -25,
    transform: [{ rotate: '-10deg' }],
  },
  cardHeader: {
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.dark,
    flex: 1,
    marginRight: 8,
    lineHeight: 20,
  },
  arrowContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepsContainer: {
    paddingHorizontal: PADDING,
    gap: 24,
  },
  stepItem: {
    alignItems: 'center',
    gap: 12,
  },
  stepCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  stepNumber: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.dark,
    color: COLORS.white,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 12,
    fontWeight: 'bold',
    overflow: 'hidden',
    zIndex: 10,
  },
  stepIconParams: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.light,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  bottomSpacer: {
    height: 40,
  },
});