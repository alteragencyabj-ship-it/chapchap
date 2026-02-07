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
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { COLORS, API_BASE_URL } from '../../src/config/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Demo() {
  const router = useRouter();
  const { setUser, setToken } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'client' | 'artisan' | null>(null);

  const handleDemoLogin = async (role: 'client' | 'artisan') => {
    console.log('🔵 Demo login started for role:', role);
    setLoading(true);
    setSelectedRole(role);

    try {
      const email = role === 'client'
        ? 'demo.client@artisan.app'
        : 'demo.artisan@artisan.app';

      console.log('🔵 Attempting login with email:', email);
      console.log('🔵 API Base URL:', API_BASE_URL);
      console.log('🔵 Full URL:', API_BASE_URL + '/api/auth/login');

      const response = await api.post('/auth/login', {
        email,
        password: 'demo123',
      });

      console.log('✅ Login successful:', response.data.user.name);

      const { access_token, user } = response.data;
      await setToken(access_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(user));
      setUser(user);

      console.log('✅ Redirecting to tabs...');
      // Small delay to let zustand propagate state before navigation
      setTimeout(() => {
        if (user.role === 'artisan') {
          router.replace('/(tabs)/artisan-home');
        } else {
          router.replace('/(tabs)/home');
        }
      }, 100);
    } catch (error: any) {
      console.error('❌ Demo login error:', error);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error response:', error.response);
      console.error('❌ Error config:', error.config);

      let errorMessage = 'Erreur de connexion';
      if (error.message) {
        errorMessage += ': ' + error.message;
      }
      if (error.code) {
        errorMessage += ' (' + error.code + ')';
      }

      Alert.alert(
        'Erreur de connexion',
        errorMessage,
        [
          {
            text: 'OK',
            onPress: () => {
              setLoading(false);
              setSelectedRole(null);
            }
          }
        ]
      );
      return;
    } finally {
      setLoading(false);
      setSelectedRole(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <View style={styles.content}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Ionicons name="flash" size={60} color={COLORS.white} />
          <Text style={styles.title}>Découvrez ARTISAN</Text>
          <Text style={styles.subtitle}>
            Testez l'app avec un compte démo
          </Text>
          {__DEV__ && (
            <Text style={styles.debugText}>API: {API_BASE_URL}</Text>
          )}
        </View>

        <View style={styles.optionsContainer}>
          <Text style={styles.optionsTitle}>Choisissez votre rôle :</Text>

          <TouchableOpacity
            style={[
              styles.roleCard,
              loading && selectedRole === 'client' && styles.roleCardLoading,
            ]}
            onPress={() => handleDemoLogin('client')}
            disabled={loading}
          >
            <View style={styles.roleIcon}>
              <Ionicons name="person" size={40} color={COLORS.primary} />
            </View>
            <View style={styles.roleInfo}>
              <Text style={styles.roleTitle}>Client</Text>
              <Text style={styles.roleDescription}>
                Trouvez rapidement le bon artisan
              </Text>
            </View>
            {loading && selectedRole === 'client' ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={24} color={COLORS.textLight} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.roleCard,
              loading && selectedRole === 'artisan' && styles.roleCardLoading,
            ]}
            onPress={() => handleDemoLogin('artisan')}
            disabled={loading}
          >
            <View style={styles.roleIcon}>
              <Ionicons name="construct" size={40} color={COLORS.primary} />
            </View>
            <View style={styles.roleInfo}>
              <Text style={styles.roleTitle}>Artisan</Text>
              <Text style={styles.roleDescription}>
                Recevez des missions à proximité
              </Text>
            </View>
            {loading && selectedRole === 'artisan' ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={24} color={COLORS.textLight} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <View style={styles.infoCard}>
            <Ionicons name="information-circle" size={20} color={COLORS.primary} />
            <Text style={styles.infoText}>
              Comptes de démo pré-configurés pour tester l'app
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
    padding: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    marginBottom: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.white,
    marginTop: 20,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.white,
    textAlign: 'center',
    opacity: 0.9,
    marginHorizontal: 20,
    lineHeight: 22,
  },
  debugText: {
    fontSize: 10,
    color: COLORS.white,
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 8,
  },
  optionsContainer: {
    flex: 1,
  },
  optionsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 20,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    gap: 16,
  },
  roleCardLoading: {
    opacity: 0.7,
  },
  roleIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleInfo: {
    flex: 1,
  },
  roleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 4,
  },
  roleDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  footer: {
    marginTop: 20,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.white,
    lineHeight: 20,
  },
});
