import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Linking,
  Alert,
  StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADII, SHADOWS, SPACING } from '../src/config/constants';

const SUPPORT_PHONE = process.env.EXPO_PUBLIC_SUPPORT_PHONE || '+2250700000000';
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@artisan.ci';

async function openExternal(url: string, fallbackError: string) {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert('Indisponible', fallbackError);
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert('Erreur', fallbackError);
  }
}

export default function SupportScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId?: string; from?: string }>();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Assistance</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={26} color="#FF9F0A" />
          </View>
          <Text style={styles.heroTitle}>Litige en cours</Text>
          <Text style={styles.heroText}>
            Notre equipe support prend le relais pour vous aider a resoudre la situation rapidement.
          </Text>
          {requestId ? <Text style={styles.requestId}>Mission: {requestId}</Text> : null}
        </View>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() =>
            openExternal(
              `tel:${SUPPORT_PHONE}`,
              "Impossible d'ouvrir l'appel telephonique pour le moment.",
            )
          }
        >
          <View style={[styles.actionIcon, { backgroundColor: `${COLORS.success}18` }]}>
            <Ionicons name="call" size={20} color={COLORS.success} />
          </View>
          <View style={styles.actionBody}>
            <Text style={styles.actionTitle}>Appeler le support</Text>
            <Text style={styles.actionSubtitle}>{SUPPORT_PHONE}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() =>
            openExternal(
              `mailto:${SUPPORT_EMAIL}?subject=Demande%20assistance%20mission`,
              "Impossible d'ouvrir votre application email pour le moment.",
            )
          }
        >
          <View style={[styles.actionIcon, { backgroundColor: `${COLORS.info}18` }]}>
            <Ionicons name="mail" size={20} color={COLORS.info} />
          </View>
          <View style={styles.actionBody}>
            <Text style={styles.actionTitle}>Envoyer un email</Text>
            <Text style={styles.actionSubtitle}>{SUPPORT_EMAIL}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/(tabs)/messages')}
        >
          <Ionicons name="chatbubbles" size={18} color={COLORS.white} />
          <Text style={styles.primaryButtonText}>Retour au chat</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.neutral50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  backBtn: {
    padding: SPACING.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.dark,
  },
  content: {
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  heroCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF9F0A16',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  heroTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: SPACING.sm,
  },
  heroText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 21,
  },
  requestId: {
    marginTop: SPACING.md,
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADII.md,
    padding: SPACING.md,
    gap: SPACING.md,
    ...SHADOWS.sm,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBody: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
  },
  actionSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textLight,
  },
  primaryButton: {
    marginTop: SPACING.lg,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADII.lg,
    paddingVertical: SPACING.md,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
