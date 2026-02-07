import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { COLORS } from '../../src/config/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Register() {
  const router = useRouter();
  const { setUser, setToken } = useAuthStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'client' | 'artisan'>('client');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleRegister = async () => {
    if (!name || !email || !phone || !password) {
      Alert.alert('Champs requis', 'Veuillez remplir tous les champs.');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/register', {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        password,
        role,
      });

      const { access_token, user } = response.data;
      await setToken(access_token);
      setUser(user);
      await AsyncStorage.setItem('user_data', JSON.stringify(user));

      if (user.role === 'artisan') {
        router.replace('/(tabs)/artisan-home');
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (error: any) {
      const msg = error.response?.data?.detail || 'Une erreur est survenue';
      Alert.alert('Erreur', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={28} color={COLORS.secondary} />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>Créer un compte</Text>
            <Text style={styles.subtitle}>Rejoignez l'élite du service.</Text>
          </View>

          <View style={styles.form}>
            {/* Novel Role Selector */}
            <View style={styles.roleContainer}>
              <TouchableOpacity
                style={[styles.roleCard, role === 'client' && styles.roleCardActive]}
                onPress={() => setRole('client')}
                activeOpacity={0.9}
              >
                <View style={[styles.roleIcon, role === 'client' ? { backgroundColor: COLORS.white } : { backgroundColor: COLORS.light }]}>
                  <Ionicons name="person" size={24} color={role === 'client' ? COLORS.primary : COLORS.textLight} />
                </View>
                <Text style={[styles.roleText, role === 'client' && styles.roleTextActive]}>Client</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.roleCard, role === 'artisan' && styles.roleCardActive]}
                onPress={() => setRole('artisan')}
                activeOpacity={0.9}
              >
                <View style={[styles.roleIcon, role === 'artisan' ? { backgroundColor: COLORS.white } : { backgroundColor: COLORS.light }]}>
                  <Ionicons name="briefcase" size={24} color={role === 'artisan' ? COLORS.primary : COLORS.textLight} />
                </View>
                <Text style={[styles.roleText, role === 'artisan' && styles.roleTextActive]}>Artisan</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Nom complet"
                  placeholderTextColor={COLORS.textLight}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Adresse email"
                  placeholderTextColor={COLORS.textLight}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <Ionicons name="call-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Téléphone"
                  placeholderTextColor={COLORS.textLight}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Mot de passe"
                  placeholderTextColor={COLORS.textLight}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={COLORS.textLight}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.registerButton, loading && styles.disabledButton]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.registerButtonText}>Inscription</Text>
              )}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Déjà inscrit ? </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
                <Text style={styles.linkText}>Connexion</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 40,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    marginBottom: 24,
    marginLeft: -8,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.secondary,
    marginBottom: 8,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  form: {
    gap: 16,
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  roleCard: {
    flex: 1,
    backgroundColor: COLORS.light,
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  roleCardActive: {
    backgroundColor: COLORS.primary + '10', // 10% opacity primary
    borderColor: COLORS.primary,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  roleTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  inputGroup: {
    marginBottom: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: 20,
    paddingHorizontal: 20,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    height: '100%',
    fontWeight: '500',
  },
  eyeIcon: {
    padding: 10,
  },
  registerButton: {
    backgroundColor: COLORS.primary,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  disabledButton: {
    opacity: 0.7,
  },
  registerButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
    alignItems: 'center',
  },
  footerText: {
    color: COLORS.textLight,
    fontSize: 15,
    fontWeight: '500',
  },
  linkText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});