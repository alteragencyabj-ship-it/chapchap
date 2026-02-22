import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  BackHandler,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import api from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { COLORS, SHADOWS, SPACING, RADII, TYPOGRAPHY } from '../src/config/constants';

type PaymentMethod = 'card' | 'wave' | 'orange_money' | 'cash';
type AddressMode = 'saved' | 'current_location' | 'manual';

interface SavedAddress {
  _id: string;
  label?: string;
  address: string;
  quartier?: string;
  is_default?: boolean;
  location?: {
    type?: string;
    coordinates?: number[];
  };
}

// Validates Ivorian phone numbers: +225 followed by 10 digits, or 10 digits alone
function isValidIvorianPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-().]/g, '');
  // +225 XX XX XX XX XX (10 digits after country code)
  if (/^\+225\d{10}$/.test(cleaned)) return true;
  // 0X XX XX XX XX (10 digits starting with 0)
  if (/^0\d{9}$/.test(cleaned)) return true;
  // XX XX XX XX XX (10 digits without leading 0 or country code)
  if (/^\d{10}$/.test(cleaned)) return true;
  return false;
}

export default function Checkout() {
  const router = useRouter();
  const { artisanId, artisanName, serviceName, servicePrice, categoryId } = useLocalSearchParams();
  const user = useAuthStore((state) => state.user);

  const [address, setAddress] = useState(user?.address || '');
  const [quartier, setQuartier] = useState(user?.quartier || '');
  const [addressMode, setAddressMode] = useState<AddressMode>('manual');
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState<string | null>(null);
  const [resolvedLocation, setResolvedLocation] = useState<{ type: 'Point'; coordinates: [number, number] } | null>(null);
  const [locating, setLocating] = useState(false);
  const [phone, setPhone] = useState(user?.phone || '');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const hasUnsavedChanges = useRef(false);

  const applySavedAddress = useCallback((item: SavedAddress) => {
    setSelectedSavedAddressId(item._id);
    setAddress(item.address || '');
    setQuartier(item.quartier || '');
    const coords = item.location?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
        setResolvedLocation({ type: 'Point', coordinates: [lng, lat] });
        return;
      }
    }
    setResolvedLocation(null);
  }, []);

  const loadSavedAddresses = useCallback(async () => {
    try {
      const res = await api.get('/clients/addresses');
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      setSavedAddresses(items);
      if (items.length > 0) {
        const preferred = items.find((it: SavedAddress) => it?.is_default) || items[0];
        setAddressMode('saved');
        applySavedAddress(preferred);
      }
    } catch (error: any) {
      if (error?.response?.status !== 403) {
        console.warn('Saved addresses unavailable:', error?.response?.status || error?.message);
      }
    }
  }, [applySavedAddress]);

  useEffect(() => {
    loadSavedAddresses();
  }, [loadSavedAddresses]);

  const useCurrentLocation = useCallback(async () => {
    setAddressMode('current_location');
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Autorisez la localisation pour utiliser votre position actuelle.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = current.coords;
      setResolvedLocation({ type: 'Point', coordinates: [longitude, latitude] });

      const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
      const first = reverse?.[0];
      const computedQuartier =
        first?.district || first?.subregion || first?.city || '';
      const computedAddress = [
        first?.name,
        first?.street,
        first?.postalCode,
        first?.city,
      ]
        .filter(Boolean)
        .join(', ');

      if (computedQuartier) setQuartier(computedQuartier);
      if (computedAddress) setAddress(computedAddress);
    } catch {
      Alert.alert('Localisation indisponible', 'Impossible de recuperer votre position actuelle.');
    } finally {
      setLocating(false);
    }
  }, []);

  // Track form changes for unsaved changes warning
  useEffect(() => {
    const hasChanges = address !== (user?.address || '') ||
      quartier !== (user?.quartier || '') ||
      phone !== (user?.phone || '') ||
      notes !== '';
    hasUnsavedChanges.current = hasChanges;
  }, [address, quartier, phone, notes, user, addressMode]);

  // Handle hardware back button (Android) with unsaved changes warning
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (hasUnsavedChanges.current && !submitted) {
        Alert.alert(
          'Quitter ?',
          'Vos modifications ne seront pas sauvegardees.',
          [
            { text: 'Rester', style: 'cancel' },
            { text: 'Quitter', style: 'destructive', onPress: () => router.back() },
          ]
        );
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, [router, submitted]);

  const handleBackPress = useCallback(() => {
    if (hasUnsavedChanges.current && !submitted) {
      Alert.alert(
        'Quitter ?',
        'Vos modifications ne seront pas sauvegardees.',
        [
          { text: 'Rester', style: 'cancel' },
          { text: 'Quitter', style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  }, [router, submitted]);

  const paymentMethods = [
    { id: 'card' as PaymentMethod, name: 'Carte Bancaire', icon: 'card' },
    { id: 'wave' as PaymentMethod, name: 'Wave', icon: 'phone-portrait' },
    { id: 'orange_money' as PaymentMethod, name: 'Orange Money', icon: 'phone-portrait' },
    { id: 'cash' as PaymentMethod, name: 'EspÃ¨ces', icon: 'cash' },
  ];

  const handleConfirm = async () => {
    // Prevent double submission
    if (loading || submitted) return;

    if (addressMode === 'saved' && !selectedSavedAddressId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Adresse requise', 'Veuillez choisir une adresse enregistree.');
      return;
    }

    const addressText = address.trim();
    let quartierText = quartier.trim();
    if (!quartierText && addressText.includes(',')) {
      quartierText = addressText.split(',', 1)[0].trim();
    }

    if (!addressText) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Champ manquant', 'Veuillez saisir votre adresse complete.');
      return;
    }
    if (!quartierText) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Champ manquant', 'Veuillez saisir votre quartier.');
      return;
    }
    if (!phone.trim()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Champ manquant', 'Veuillez saisir votre numero de telephone.');
      return;
    }
    if (!isValidIvorianPhone(phone)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Numero invalide',
        'Veuillez saisir un numero ivoirien valide (ex: +225 07 XX XX XX XX ou 07 XX XX XX XX).'
      );
      return;
    }

    // Verify required params exist
    if (!artisanId || !serviceName) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', 'Informations de service manquantes. Veuillez recommencer.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const locationPayload =
        resolvedLocation ||
        ({ type: 'Point', coordinates: [0, 0] } as const);
      const finalAddress = quartierText && !addressText.toLowerCase().startsWith(quartierText.toLowerCase())
        ? `${quartierText}, ${addressText}`
        : addressText;
      const requestData = {
        artisan_id: artisanId as string,
        service_type: (categoryId as string) || '',
        service_name: serviceName as string,
        service_price: (servicePrice as string) || '',
        description: notes.trim() || `Demande pour ${serviceName}`,
        address: finalAddress,
        phone: phone.trim(),
        payment_method: paymentMethod,
        photos: [],
        location: locationPayload,
      };

      const response = await api.post('/requests', requestData);
      setSubmitted(true);
      hasUnsavedChanges.current = false;

      router.push({
        pathname: '/booking-confirmation',
        params: {
          bookingId: response.data?._id || '',
          artisanName: artisanName || '',
          serviceName: serviceName || '',
          servicePrice: servicePrice || '',
        }
      });
    } catch (error: any) {
      console.error('Failed to create booking:', error);

      let title = 'Erreur';
      let message = 'Impossible de creer la reservation. Veuillez reessayer.';

      if (!error.response) {
        // Network error (no response from server)
        title = 'Probleme de connexion';
        message = 'Verifiez votre connexion internet et reessayez.';
      } else if (error.response.status === 408 || error.code === 'ECONNABORTED') {
        title = 'Delai depasse';
        message = 'Le serveur met trop de temps a repondre. Veuillez reessayer.';
      } else if (error.response.status === 409) {
        title = 'Demande dupliquee';
        message = 'Une demande similaire existe deja.';
      } else if (error.response?.data?.detail) {
        message = error.response.data.detail;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(title, message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBackPress} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Passage en caisse</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary Card */}
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>RÃ©capitulatif</Text>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Service :</Text>
              <Text style={styles.summaryValue}>{serviceName || 'Non specifie'}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Artisan :</Text>
              <Text style={styles.summaryValue}>{artisanName || 'Non specifie'}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Prix :</Text>
              <Text style={styles.priceSummary}>{servicePrice ? `${servicePrice} FCFA` : 'Sur devis'}</Text>
            </View>
          </View>

          {/* Client Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Informations de livraison</Text>
            
            <View style={styles.addressModeRow}>
              {savedAddresses.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.addressModeChip,
                    addressMode === 'saved' && styles.addressModeChipActive,
                  ]}
                  onPress={() => setAddressMode('saved')}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="home-outline"
                    size={14}
                    color={addressMode === 'saved' ? COLORS.white : COLORS.textLight}
                  />
                  <Text
                    style={[
                      styles.addressModeText,
                      addressMode === 'saved' && styles.addressModeTextActive,
                    ]}
                  >
                    Adresse enregistree
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.addressModeChip,
                  addressMode === 'current_location' && styles.addressModeChipActive,
                ]}
                onPress={useCurrentLocation}
                activeOpacity={0.8}
              >
                {locating ? (
                  <ActivityIndicator size="small" color={addressMode === 'current_location' ? COLORS.white : COLORS.primary} />
                ) : (
                  <Ionicons
                    name="locate-outline"
                    size={14}
                    color={addressMode === 'current_location' ? COLORS.white : COLORS.textLight}
                  />
                )}
                <Text
                  style={[
                    styles.addressModeText,
                    addressMode === 'current_location' && styles.addressModeTextActive,
                  ]}
                >
                  Position actuelle
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.addressModeChip,
                  addressMode === 'manual' && styles.addressModeChipActive,
                ]}
                onPress={() => {
                  setAddressMode('manual');
                  setResolvedLocation(null);
                }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="create-outline"
                  size={14}
                  color={addressMode === 'manual' ? COLORS.white : COLORS.textLight}
                />
                <Text
                  style={[
                    styles.addressModeText,
                    addressMode === 'manual' && styles.addressModeTextActive,
                  ]}
                >
                  Nouvelle adresse
                </Text>
              </TouchableOpacity>
            </View>

            {addressMode === 'saved' && savedAddresses.length > 0 && (
              <View style={styles.savedAddressesList}>
                {savedAddresses.map((item) => {
                  const selected = selectedSavedAddressId === item._id;
                  return (
                    <TouchableOpacity
                      key={item._id}
                      style={[styles.savedAddressItem, selected && styles.savedAddressItemSelected]}
                      onPress={() => applySavedAddress(item)}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={selected ? COLORS.primary : COLORS.textLight}
                      />
                      <View style={styles.savedAddressTextWrap}>
                        <Text style={styles.savedAddressTitle}>
                          {item.label || 'Adresse'}
                          {item.is_default ? ' • Par defaut' : ''}
                        </Text>
                        <Text style={styles.savedAddressValue}>
                          {item.quartier ? `${item.quartier}, ` : ''}{item.address}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {addressMode !== 'saved' && (
              <>
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Quartier *</Text>
                  <TextInput
                    style={styles.input}
                    value={quartier}
                    onChangeText={(value) => {
                      setQuartier(value);
                    }}
                    placeholder="Ex: Cocody, Angre"
                    placeholderTextColor={COLORS.textLight}
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Adresse complete *</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={address}
                    onChangeText={(value) => {
                      setAddress(value);
                    }}
                    placeholder="Ex: Villa 123, Rue des Palmiers"
                    placeholderTextColor={COLORS.textLight}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              </>
            )}
<View style={styles.inputContainer}>
              <Text style={styles.label}>NumÃ©ro de tÃ©lÃ©phone *</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="Ex: +225 07 XX XX XX XX"
                placeholderTextColor={COLORS.textLight}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Instructions supplÃ©mentaires (optionnel)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="PrÃ©cisions, accÃ¨s, horaires..."
                placeholderTextColor={COLORS.textLight}
                multiline
                numberOfLines={3}
              />
            </View>
          </View>

          {/* Payment Method */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mode de paiement</Text>
            
            <View style={styles.paymentGrid}>
              {paymentMethods.map((method) => (
                <TouchableOpacity
                  key={method.id}
                  style={[
                    styles.paymentCard,
                    paymentMethod === method.id && styles.paymentCardSelected,
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setPaymentMethod(method.id); }}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.paymentIconContainer,
                    paymentMethod === method.id && styles.paymentIconContainerSelected,
                  ]}>
                    <Ionicons
                      name={method.icon as any}
                      size={28}
                      color={paymentMethod === method.id ? COLORS.primary : COLORS.textLight}
                    />
                  </View>
                  <Text style={[
                    styles.paymentName,
                    paymentMethod === method.id && styles.paymentNameSelected,
                  ]}>
                    {method.name}
                  </Text>
                  {paymentMethod === method.id && (
                    <View style={styles.checkmark}>
                      <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Confirm Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.confirmButton, (loading || submitted) && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={loading || submitted}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Text style={styles.confirmButtonText}>Confirmer la rÃ©servation</Text>
                <Ionicons name="arrow-forward" size={20} color={COLORS.white} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.neutral50,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
    fontWeight: '600',
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: 100,
  },
  summaryCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  summaryLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
  },
  summaryValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
    textAlign: 'right',
  },
  priceSummary: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: SPACING.lg,
  },
  addressModeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  addressModeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.neutral50,
  },
  addressModeChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  addressModeText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  addressModeTextActive: {
    color: COLORS.white,
  },
  savedAddressesList: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  savedAddressItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.neutral50,
  },
  savedAddressItemSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}08`,
  },
  savedAddressTextWrap: {
    flex: 1,
  },
  savedAddressTitle: {
    ...TYPOGRAPHY.label,
    color: COLORS.dark,
    marginBottom: 2,
  },
  savedAddressValue: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textLight,
    lineHeight: 16,
  },
  inputContainer: {
    marginBottom: SPACING.lg,
  },
  label: {
    ...TYPOGRAPHY.label,
    marginBottom: SPACING.sm,
  },
  input: {
    backgroundColor: COLORS.neutral50,
    borderRadius: RADII.md,
    padding: SPACING.lg,
    fontSize: 14,
    color: COLORS.dark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  paymentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  paymentCard: {
    width: '47%',
    backgroundColor: COLORS.neutral50,
    borderRadius: RADII.md,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    minHeight: 110,
    justifyContent: 'center',
  },
  paymentCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}08`,
  },
  paymentIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  paymentIconContainerSelected: {
    backgroundColor: `${COLORS.primary}15`,
  },
  paymentName: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    color: COLORS.dark,
    textAlign: 'center',
  },
  paymentNameSelected: {
    color: COLORS.primary,
  },
  checkmark: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
  },
  footer: {
    backgroundColor: COLORS.white,
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  confirmButton: {
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
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
});

