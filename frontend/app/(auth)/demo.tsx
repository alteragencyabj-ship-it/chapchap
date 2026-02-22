import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { COLORS, RADII, SHADOWS, API_BASE_URL } from '../../src/config/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Demo() {
  const router = useRouter();
  const { setUser, setToken } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'client' | 'artisan' | null>(null);

  const handleDemoLogin = async (role: 'client' | 'artisan') => {
    if (loading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setSelectedRole(role);

    try {
      const email = role === 'client'
        ? 'demo.client@artisan.app'
        : 'demo.artisan@artisan.app';

      const response = await api.post('/auth/login', {
        email,
        password: 'demo123',
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const { access_token, user } = response.data;
      await setToken(access_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(user));
      setUser(user);

      // Small delay to let zustand propagate state before navigation
      setTimeout(() => {
        if (user.role === 'artisan') {
          router.replace('/(tabs)/artisan-home');
        } else {
          router.replace('/(tabs)/home');
        }
      }, 100);
    } catch (error: any) {
      if (__DEV__) {
        console.error('Demo login error', {
          message: error?.message,
          code: error?.code,
          status: error?.response?.status,
          url: error?.config?.url,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      let errorMessage: string;
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        errorMessage = 'Les comptes demo ne sont pas configures sur le serveur. Contactez le support.';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Le serveur met trop de temps a repondre. Reessayez.';
      } else if (!error.response) {
        errorMessage = 'Impossible de joindre le serveur. Verifiez votre connexion internet.';
      } else {
        errorMessage = error.response?.data?.detail || 'Une erreur inattendue est survenue. Reessayez.';
      }

      setLoading(false);
      setSelectedRole(null);
      Alert.alert('Connexion demo impossible', errorMessage);
      return;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <View style={styles.content}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          disabled={loading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={loading ? 'transparent' : COLORS.white} />
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.flashIconContainer}>
            <Ionicons name="flash" size={48} color={COLORS.iconSand} />
          </View>
          <Text style={styles.title}>Decouvrez ARTISAN</Text>
          <Text style={styles.subtitle}>
            Testez l'app avec un compte demo
          </Text>
          {__DEV__ && (
            <Text style={styles.debugText}>API: {API_BASE_URL}</Text>
          )}
        </View>

        <View style={styles.optionsContainer}>
          <Text style={styles.optionsTitle}>Choisissez votre role :</Text>

          <TouchableOpacity
            style={[
              styles.roleCard,
              loading && selectedRole === 'client' && styles.roleCardLoading,
              loading && selectedRole !== 'client' && styles.roleCardDisabled,
            ]}
            onPress={() => handleDemoLogin('client')}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={[styles.roleIcon, styles.roleIconClient]}>
              <Ionicons name="person" size={28} color={COLORS.iconSteel} />
            </View>
            <View style={styles.roleInfo}>
              <Text style={styles.roleTitle}>Client</Text>
              <Text style={styles.roleDescription}>
                Trouvez rapidement le bon artisan
              </Text>
            </View>
            {loading && selectedRole === 'client' ? (
              <ActivityIndicator color={COLORS.primary} size="small" />
            ) : (
              <Ionicons name="chevron-forward" size={20} color={COLORS.neutral400} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.roleCard,
              loading && selectedRole === 'artisan' && styles.roleCardLoading,
              loading && selectedRole !== 'artisan' && styles.roleCardDisabled,
            ]}
            onPress={() => handleDemoLogin('artisan')}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={[styles.roleIcon, styles.roleIconArtisan]}>
              <Ionicons name="construct" size={28} color={COLORS.iconSage} />
            </View>
            <View style={styles.roleInfo}>
              <Text style={styles.roleTitle}>Artisan</Text>
              <Text style={styles.roleDescription}>
                Recevez des missions a proximite
              </Text>
            </View>
            {loading && selectedRole === 'artisan' ? (
              <ActivityIndicator color={COLORS.primary} size="small" />
            ) : (
              <Ionicons name="chevron-forward" size={20} color={COLORS.neutral400} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <View style={styles.infoCard}>
            <Ionicons name="information-circle" size={20} color={COLORS.iconIce} />
            <Text style={styles.infoText}>
              Comptes de demo pre-configures pour tester l'app
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'android' ? 32 : 24,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: RADII.sm,
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  flashIconContainer: {
    width: 88,
    height: 88,
    borderRadius: RADII.xl + 4,
    backgroundColor: `${COLORS.iconSand}20`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.white,
    marginTop: 20,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.white,
    textAlign: 'center',
    opacity: 0.85,
    marginHorizontal: 20,
    lineHeight: 24,
    fontWeight: '500',
  },
  debugText: {
    fontSize: 10,
    color: COLORS.white,
    textAlign: 'center',
    opacity: 0.5,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  optionsContainer: {
    flex: 1,
  },
  optionsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 20,
    opacity: 0.9,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADII.xl,
    padding: 20,
    marginBottom: 16,
    gap: 16,
    minHeight: 88,
    ...SHADOWS.md,
  },
  roleCardLoading: {
    opacity: 0.85,
  },
  roleCardDisabled: {
    opacity: 0.5,
  },
  roleIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleIconClient: {
    backgroundColor: `${COLORS.iconSteel}15`,
  },
  roleIconArtisan: {
    backgroundColor: `${COLORS.iconSage}15`,
  },
  roleInfo: {
    flex: 1,
  },
  roleTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: 4,
  },
  roleDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
    fontWeight: '400',
  },
  footer: {
    marginTop: 16,
    paddingBottom: 8,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${COLORS.white}20`,
    borderRadius: RADII.md,
    padding: 16,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.white,
    lineHeight: 20,
    opacity: 0.9,
    fontWeight: '400',
  },
});
