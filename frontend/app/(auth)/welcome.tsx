import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS, RADII } from '../../src/config/constants';

export default function Welcome() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Decorative Background Elements */}
      <View style={styles.circle1} />
      <View style={styles.circle2} />

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="cube-outline" size={64} color={COLORS.iconSteel} />
          </View>
          <Text style={styles.title}>ARTISAN</Text>
          <Text style={styles.subtitle}>
            L'excellence à la demande.{'\n'}Des experts qualifiés, chez vous.
          </Text>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(auth)/register'); }}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Commencer</Text>
            <Ionicons name="arrow-forward" size={20} color={COLORS.white} />
          </TouchableOpacity>

          <View style={styles.secondaryActions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push('/(auth)/login')}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            >
              <Text style={styles.secondaryButtonText}>Déjà un compte ? Connexion</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.demoLink}
              onPress={() => router.push('/(auth)/demo')}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            >
              <Text style={styles.demoLinkText}>Mode Démo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    position: 'relative',
    overflow: 'hidden',
  },
  circle1: {
    position: 'absolute',
    top: -100,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: COLORS.primary,
    opacity: 0.05,
    transform: [{ scale: 1.5 }],
  },
  circle2: {
    position: 'absolute',
    bottom: 100,
    left: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: COLORS.iconSage,
    opacity: 0.03,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'android' ? 32 : 20,
  },
  header: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginTop: 60,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: RADII.xl + 10,
    backgroundColor: `${COLORS.iconSteel}22`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    transform: [{ rotate: '-10deg' }],
  },
  title: {
    fontSize: 56,
    fontWeight: '800',
    color: COLORS.secondary,
    letterSpacing: -1.5,
    marginBottom: 16,
    lineHeight: 64,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textLight,
    lineHeight: 28,
    fontWeight: '500',
  },
  footer: {
    width: '100%',
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    height: 64,
    borderRadius: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 24,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryActions: {
    alignItems: 'center',
    gap: 12,
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: COLORS.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
  demoLink: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  demoLinkText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
