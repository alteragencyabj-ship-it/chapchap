import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../src/config/constants';

export default function BookingConfirmation() {
  const router = useRouter();
  const { bookingId, artisanName, serviceName, servicePrice } = useLocalSearchParams();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      
      <View style={styles.content}>
        {/* Success Icon */}
        <View style={styles.iconContainer}>
          <View style={styles.successCircle}>
            <Ionicons name="checkmark" size={60} color={COLORS.white} />
          </View>
        </View>

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
            <Text style={styles.detailValue}>{serviceName}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Ionicons name="person" size={20} color={COLORS.primary} />
            <Text style={styles.detailLabel}>Artisan :</Text>
            <Text style={styles.detailValue}>{artisanName}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Ionicons name="pricetag" size={20} color={COLORS.primary} />
            <Text style={styles.detailLabel}>Prix :</Text>
            <Text style={styles.detailValue}>{servicePrice} FCFA</Text>
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
    backgroundColor: COLORS.light,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 32,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.secondary,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginBottom: 32,
    textAlign: 'center',
  },
  detailsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textLight,
    marginLeft: 12,
    marginRight: 8,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
  },
  statusCard: {
    backgroundColor: `${COLORS.warning}15`,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: `${COLORS.warning}30`,
  },
  statusIcon: {
    marginBottom: 12,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 8,
    textAlign: 'center',
  },
  statusText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  secondaryButton: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.dark,
  },
});
