import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  StatusBar,
  Animated,
  BackHandler,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS, SHADOWS, SPACING, RADII, TYPOGRAPHY } from '../src/config/constants';

export default function BookingConfirmation() {
  const router = useRouter();
  const { artisanName, serviceName, servicePrice } = useLocalSearchParams();

  // Spring animation for the success icon
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 3,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  // Prevent back navigation to checkout (would cause double-submit risk)
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Navigate to home instead of going back to checkout
      router.replace('/(tabs)/home');
      return true;
    });
    return () => backHandler.remove();
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      
      <View style={styles.content}>
        {/* Success Icon */}
        <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.successCircle}>
            <Ionicons name="checkmark" size={60} color={COLORS.white} />
          </View>
        </Animated.View>

        {/* Success Message */}
        <Text style={styles.title}>Réservation confirmée !</Text>
        <Text style={styles.subtitle}>
          Votre demande a été envoyée avec succès
        </Text>

        {/* Booking Details */}
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Ionicons name="hammer" size={20} color={COLORS.primary} />
            <Text style={styles.detailLabel}>Service :</Text>
            <Text style={styles.detailValue}>{serviceName || 'Non specifie'}</Text>
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="person" size={20} color={COLORS.primary} />
            <Text style={styles.detailLabel}>Artisan :</Text>
            <Text style={styles.detailValue}>{artisanName || 'Non specifie'}</Text>
          </View>

          <View style={styles.detailRow}>
            <Ionicons name="pricetag" size={20} color={COLORS.primary} />
            <Text style={styles.detailLabel}>Prix :</Text>
            <Text style={styles.detailValue}>{servicePrice ? `${servicePrice} FCFA` : 'Sur devis'}</Text>
          </View>
        </View>

        {/* Status Info */}
        <View style={styles.statusCard}>
          <View style={styles.statusIcon}>
            <Ionicons name="time-outline" size={32} color={COLORS.warning} />
          </View>
          <Text style={styles.statusTitle}>En attente de confirmation</Text>
          <Text style={styles.statusText}>
            L'artisan va recevoir votre demande et vous contactera sous peu.
            Vous serez notifié dès qu'il acceptera la mission.
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/(tabs)/my-requests')}
            activeOpacity={0.8}
          >
            <Ionicons name="list" size={20} color={COLORS.white} />
            <Text style={styles.primaryButtonText}>Voir mes demandes</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/(tabs)/home')}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>Retour à l'accueil</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.neutral50,
  },
  content: {
    flex: 1,
    padding: SPACING['2xl'],
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: SPACING['3xl'],
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.success,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    ...TYPOGRAPHY.h1,
    fontSize: 26,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: SPACING['3xl'],
    textAlign: 'center',
    lineHeight: 22,
  },
  detailsCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.xl,
    width: '100%',
    marginBottom: SPACING['2xl'],
    ...SHADOWS.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  detailLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
    marginLeft: SPACING.md,
    marginRight: SPACING.sm,
  },
  detailValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
  },
  statusCard: {
    backgroundColor: `${COLORS.warning}15`,
    borderRadius: RADII.lg,
    padding: SPACING.xl,
    width: '100%',
    alignItems: 'center',
    marginBottom: SPACING['3xl'],
    borderWidth: 1,
    borderColor: `${COLORS.warning}30`,
  },
  statusIcon: {
    marginBottom: SPACING.md,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  statusText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonContainer: {
    width: '100%',
    gap: SPACING.md,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADII.md,
    paddingVertical: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 52,
    ...SHADOWS.md,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  secondaryButton: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.md,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 52,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
  },
});
