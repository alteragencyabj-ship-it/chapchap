import React, { useState, useRef, useCallback } from 'react';
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
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { COLORS, RADII } from '../../src/config/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const router = useRouter();
  const { setUser, setToken } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const validateEmail = useCallback((value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) {
      setEmailError('L\'adresse email est requise.');
      return false;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError('Format d\'email invalide.');
      return false;
    }
    setEmailError('');
    return true;
  }, []);

  const validatePassword = useCallback((value: string): boolean => {
    if (!value) {
      setPasswordError('Le mot de passe est requis.');
      return false;
    }
    setPasswordError('');
    return true;
  }, []);

  const handleLogin = async () => {
    if (submitting) return;

    Keyboard.dismiss();

    const trimmedEmail = email.trim();
    const isEmailValid = validateEmail(trimmedEmail);
    const isPasswordValid = validatePassword(password);

    if (!isEmailValid || !isPasswordValid) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const response = await api.post('/auth/login', {
        email: trimmedEmail.toLowerCase(),
        password,
      });

      const { access_token, user } = response.data;
      await setToken(access_token);
      setUser(user);
      await AsyncStorage.setItem('user_data', JSON.stringify(user));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (user.role === 'artisan') {
        router.replace('/(tabs)/artisan-home');
      } else {
        router.replace('/(tabs)/home');
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const status = error.response?.status;
      let msg: string;
      if (status === 401 || status === 403) {
        msg = 'Email ou mot de passe incorrect. Verifiez vos identifiants.';
      } else if (status === 404) {
        msg = 'Aucun compte associe a cet email.';
      } else if (error.code === 'ECONNABORTED') {
        msg = 'Le serveur met trop de temps a repondre. Reessayez.';
      } else if (!error.response) {
        msg = 'Impossible de joindre le serveur. Verifiez votre connexion internet.';
      } else {
        msg = error.response?.data?.detail || 'Une erreur inattendue est survenue. Reessayez.';
      }
      Alert.alert('Connexion impossible', msg);
    } finally {
      setLoading(false);
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={true}
          >
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.secondary} />
            </TouchableOpacity>

            <View style={styles.header}>
              <Text style={styles.title}>Bienvenue.</Text>
              <Text style={styles.subtitle}>Connectez-vous pour continuer.</Text>
            </View>

            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <View style={[styles.inputWrapper, emailError ? styles.inputWrapperError : null]}>
                  <Ionicons name="mail-outline" size={20} color={emailError ? COLORS.error : COLORS.textLight} style={styles.inputIcon} />
                  <TextInput
                    ref={emailRef}
                    style={styles.input}
                    placeholder="Adresse email"
                    placeholderTextColor={COLORS.neutral400}
                    value={email}
                    onChangeText={(text) => {
                      setEmail(text);
                      if (emailError) validateEmail(text);
                    }}
                    onBlur={() => { if (email) validateEmail(email); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    blurOnSubmit={false}
                    editable={!loading}
                    textContentType="emailAddress"
                    autoComplete="email"
                  />
                </View>
                {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <View style={[styles.inputWrapper, passwordError ? styles.inputWrapperError : null]}>
                  <Ionicons name="lock-closed-outline" size={20} color={passwordError ? COLORS.error : COLORS.textLight} style={styles.inputIcon} />
                  <TextInput
                    ref={passwordRef}
                    style={styles.input}
                    placeholder="Mot de passe"
                    placeholderTextColor={COLORS.neutral400}
                    value={password}
                    onChangeText={(text) => {
                      setPassword(text);
                      if (passwordError) validatePassword(text);
                    }}
                    onBlur={() => { if (password) validatePassword(password); }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    returnKeyType="go"
                    onSubmitEditing={handleLogin}
                    editable={!loading}
                    textContentType="password"
                    autoComplete="password"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeIcon}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={COLORS.textLight}
                    />
                  </TouchableOpacity>
                </View>
                {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
              </View>

              <TouchableOpacity
                style={styles.forgotPassword}
                onPress={() => Alert.alert('Info', 'Fonctionnalite bientot disponible.')}
                hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
              >
                <Text style={styles.forgotPasswordText}>Mot de passe oublie ?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.loginButton, loading && styles.disabledButton]}
                onPress={handleLogin}
                disabled={loading || submitting}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.loginButtonText}>Connexion</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footer}>
                <Text style={styles.footerText}>Pas de compte ? </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(auth)/register')}
                  disabled={loading}
                  style={styles.footerLink}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 16 }}
                >
                  <Text style={styles.linkText}>Creer un compte</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: RADII.sm,
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginBottom: 24,
    marginLeft: -4,
  },
  header: {
    marginBottom: 48,
  },
  title: {
    fontSize: 42,
    fontWeight: '800',
    color: COLORS.secondary,
    marginBottom: 12,
    lineHeight: 48,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.textLight,
    fontWeight: '500',
    lineHeight: 26,
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: RADII.xl,
    paddingHorizontal: 20,
    height: 60,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  inputWrapperError: {
    borderColor: COLORS.error,
  },
  inputIcon: {
    marginRight: 14,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    height: '100%',
    fontWeight: '500',
  },
  eyeIcon: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    marginLeft: 20,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
  },
  forgotPasswordText: {
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '500',
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
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
  loginButtonText: {
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
  footerLink: {
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});
