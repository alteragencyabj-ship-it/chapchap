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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store/authStore';
import api from '../../src/services/api';
import { COLORS, RADII } from '../../src/config/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[\d\s\-()]{8,}$/;
const MIN_PASSWORD_LENGTH = 6;

export default function Register() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string; referral?: string; code?: string }>();
  const { setUser, setToken } = useAuthStore();
  const deepLinkReferral =
    (typeof params.ref === 'string' && params.ref)
    || (typeof params.referral === 'string' && params.referral)
    || (typeof params.code === 'string' && params.code)
    || '';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState(deepLinkReferral.toUpperCase());
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'client' | 'artisan'>('client');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Field errors
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [termsError, setTermsError] = useState('');

  // Refs for keyboard flow
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const referralRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const validateName = useCallback((value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) {
      setNameError('Le nom est requis.');
      return false;
    }
    if (trimmed.length < 2) {
      setNameError('Le nom doit comporter au moins 2 caracteres.');
      return false;
    }
    setNameError('');
    return true;
  }, []);

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

  const validatePhone = useCallback((value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) {
      setPhoneError('Le numero de telephone est requis.');
      return false;
    }
    if (!PHONE_REGEX.test(trimmed)) {
      setPhoneError('Numero de telephone invalide (min. 8 chiffres).');
      return false;
    }
    setPhoneError('');
    return true;
  }, []);

  const validatePassword = useCallback((value: string): boolean => {
    if (!value) {
      setPasswordError('Le mot de passe est requis.');
      return false;
    }
    if (value.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caracteres.`);
      return false;
    }
    setPasswordError('');
    return true;
  }, []);

  const handleRegister = async () => {
    if (submitting) return;

    Keyboard.dismiss();

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();

    const isNameValid = validateName(trimmedName);
    const isEmailValid = validateEmail(trimmedEmail);
    const isPhoneValid = validatePhone(trimmedPhone);
    const isPasswordValid = validatePassword(password);

    let isTermsValid = true;
    if (!acceptedTerms) {
      setTermsError('Vous devez accepter les conditions d\'utilisation.');
      isTermsValid = false;
    } else {
      setTermsError('');
    }

    if (!isNameValid || !isEmailValid || !isPhoneValid || !isPasswordValid || !isTermsValid) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const response = await api.post('/auth/register', {
        name: trimmedName,
        email: trimmedEmail.toLowerCase(),
        phone: trimmedPhone,
        password,
        role,
        referral_code: role === 'client' && referralCode.trim()
          ? referralCode.trim().toUpperCase()
          : undefined,
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
      if (status === 409) {
        msg = 'Un compte existe deja avec cet email. Connectez-vous plutot.';
      } else if (status === 422) {
        msg = error.response?.data?.detail || 'Donnees invalides. Verifiez vos informations.';
      } else if (error.code === 'ECONNABORTED') {
        msg = 'Le serveur met trop de temps a repondre. Reessayez.';
      } else if (!error.response) {
        msg = 'Impossible de joindre le serveur. Verifiez votre connexion internet.';
      } else {
        msg = error.response?.data?.detail || 'Une erreur inattendue est survenue. Reessayez.';
      }
      Alert.alert('Inscription impossible', msg);
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
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
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
              <Text style={styles.title}>Creer un compte</Text>
              <Text style={styles.subtitle}>Rejoignez l'elite du service.</Text>
            </View>

            <View style={styles.form}>
              {/* Role Selector */}
              <View style={styles.roleContainer}>
                <TouchableOpacity
                  style={[styles.roleCard, role === 'client' && styles.roleCardActive]}
                  onPress={() => { Haptics.selectionAsync(); setRole('client'); }}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <View style={[styles.roleIcon, role === 'client' ? styles.roleIconActive : styles.roleIconInactive]}>
                    <Ionicons name="person" size={22} color={role === 'client' ? COLORS.iconSteel : COLORS.textLight} />
                  </View>
                  <Text style={[styles.roleText, role === 'client' && styles.roleTextActive]}>Client</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.roleCard, role === 'artisan' && styles.roleCardActive]}
                  onPress={() => { Haptics.selectionAsync(); setRole('artisan'); }}
                  activeOpacity={0.9}
                  disabled={loading}
                >
                  <View style={[styles.roleIcon, role === 'artisan' ? styles.roleIconActive : styles.roleIconInactive]}>
                    <Ionicons name="briefcase" size={22} color={role === 'artisan' ? COLORS.iconSage : COLORS.textLight} />
                  </View>
                  <Text style={[styles.roleText, role === 'artisan' && styles.roleTextActive]}>Artisan</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <View style={[styles.inputWrapper, nameError ? styles.inputWrapperError : null]}>
                  <Ionicons name="person-outline" size={20} color={nameError ? COLORS.error : COLORS.textLight} style={styles.inputIcon} />
                  <TextInput
                    ref={nameRef}
                    style={styles.input}
                    placeholder="Nom complet"
                    placeholderTextColor={COLORS.neutral400}
                    value={name}
                    onChangeText={(text) => {
                      setName(text);
                      if (nameError) validateName(text);
                    }}
                    onBlur={() => { if (name) validateName(name); }}
                    autoCapitalize="words"
                    autoFocus
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    blurOnSubmit={false}
                    editable={!loading}
                    textContentType="name"
                    autoComplete="name"
                  />
                </View>
                {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
              </View>

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
                    returnKeyType="next"
                    onSubmitEditing={() => phoneRef.current?.focus()}
                    blurOnSubmit={false}
                    editable={!loading}
                    textContentType="emailAddress"
                    autoComplete="email"
                  />
                </View>
                {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <View style={[styles.inputWrapper, phoneError ? styles.inputWrapperError : null]}>
                  <Ionicons name="call-outline" size={20} color={phoneError ? COLORS.error : COLORS.textLight} style={styles.inputIcon} />
                  <TextInput
                    ref={phoneRef}
                    style={styles.input}
                    placeholder="Telephone (ex: +225 07 00 00 00)"
                    placeholderTextColor={COLORS.neutral400}
                    value={phone}
                    onChangeText={(text) => {
                      setPhone(text);
                      if (phoneError) validatePhone(text);
                    }}
                    onBlur={() => { if (phone) validatePhone(phone); }}
                    keyboardType="phone-pad"
                    returnKeyType={role === 'client' ? 'next' : 'next'}
                    onSubmitEditing={() => {
                      if (role === 'client') {
                        referralRef.current?.focus();
                      } else {
                        passwordRef.current?.focus();
                      }
                    }}
                    blurOnSubmit={false}
                    editable={!loading}
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                  />
                </View>
                {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
              </View>

              {role === 'client' && (
                <View style={styles.inputGroup}>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="ticket-outline" size={20} color={COLORS.textLight} style={styles.inputIcon} />
                    <TextInput
                      ref={referralRef}
                      style={styles.input}
                      placeholder="Code invitation (optionnel)"
                      placeholderTextColor={COLORS.neutral400}
                      value={referralCode}
                      onChangeText={setReferralCode}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                      blurOnSubmit={false}
                      editable={!loading}
                    />
                  </View>
                  <Text style={styles.helperText}>
                    Un code valide augmente la visibilite de l'artisan qui vous invite.
                  </Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <View style={[styles.inputWrapper, passwordError ? styles.inputWrapperError : null]}>
                  <Ionicons name="lock-closed-outline" size={20} color={passwordError ? COLORS.error : COLORS.textLight} style={styles.inputIcon} />
                  <TextInput
                    ref={passwordRef}
                    style={styles.input}
                    placeholder="Mot de passe (min. 6 caracteres)"
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
                    onSubmitEditing={handleRegister}
                    editable={!loading}
                    textContentType="newPassword"
                    autoComplete="password-new"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeIcon}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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

              {/* Terms & Conditions */}
              <TouchableOpacity
                style={styles.termsRow}
                onPress={() => {
                  setAcceptedTerms(!acceptedTerms);
                  if (termsError && !acceptedTerms) setTermsError('');
                }}
                activeOpacity={0.7}
                disabled={loading}
              >
                <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked, termsError ? styles.checkboxError : null]}>
                  {acceptedTerms && (
                    <Ionicons name="checkmark" size={14} color={COLORS.white} />
                  )}
                </View>
                <Text style={styles.termsText}>
                  J'accepte les conditions d'utilisation et la politique de confidentialite
                </Text>
              </TouchableOpacity>
              {termsError ? <Text style={styles.errorText}>{termsError}</Text> : null}

              <TouchableOpacity
                style={[styles.registerButton, loading && styles.disabledButton]}
                onPress={handleRegister}
                disabled={loading || submitting}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.registerButtonText}>Inscription</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footer}>
                <Text style={styles.footerText}>Deja inscrit ? </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(auth)/login')}
                  disabled={loading}
                  style={styles.footerLink}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 16 }}
                >
                  <Text style={styles.linkText}>Connexion</Text>
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
    marginBottom: 28,
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
    lineHeight: 24,
  },
  form: {
    gap: 16,
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  roleCard: {
    flex: 1,
    backgroundColor: COLORS.light,
    borderRadius: RADII.xl,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 56,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  roleCardActive: {
    backgroundColor: COLORS.neutral50,
    borderColor: COLORS.dark,
  },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: RADII.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleIconActive: {
    backgroundColor: COLORS.white,
  },
  roleIconInactive: {
    backgroundColor: COLORS.light,
  },
  roleText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  roleTextActive: {
    color: COLORS.dark,
    fontWeight: '700',
  },
  inputGroup: {
    gap: 4,
  },
  helperText: {
    marginTop: 4,
    marginLeft: 20,
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '500',
    lineHeight: 18,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: RADII.xl,
    paddingHorizontal: 20,
    height: 56,
    borderWidth: 1.5,
    borderColor: 'transparent',
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
  inputWrapperError: {
    borderColor: COLORS.error,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    marginLeft: 20,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    marginTop: 4,
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.neutral300,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkboxError: {
    borderColor: COLORS.error,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
    lineHeight: 20,
  },
  registerButton: {
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
  registerButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
    alignItems: 'center',
    paddingBottom: 8,
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
