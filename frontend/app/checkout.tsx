import React, { useState } from 'react';
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
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { COLORS } from '../src/config/constants';

type PaymentMethod = 'card' | 'wave' | 'orange_money' | 'cash';

export default function Checkout() {
  const router = useRouter();
  const { artisanId, artisanName, serviceId, serviceName, servicePrice, categoryId } = useLocalSearchParams();
  const user = useAuthStore((state) => state.user);
  
  const [address, setAddress] = useState(user?.address || '');
  const [quartier, setQuartier] = useState(user?.quartier || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [loading, setLoading] = useState(false);

  const paymentMethods = [
    { id: 'card' as PaymentMethod, name: 'Carte Bancaire', icon: 'card' },
    { id: 'wave' as PaymentMethod, name: 'Wave', icon: 'phone-portrait' },
    { id: 'orange_money' as PaymentMethod, name: 'Orange Money', icon: 'phone-portrait' },
    { id: 'cash' as PaymentMethod, name: 'Espèces', icon: 'cash' },
  ];

  const handleConfirm = async () => {
    if (!address || !quartier || !phone) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs obligatoires');
      return;
    }

    setLoading(true);
    try {
      const requestData = {
        artisan_id: artisanId as string,
        service_type: categoryId as string,
        service_name: serviceName as string,
        service_price: servicePrice as string,
        description: notes || `Demande pour ${serviceName}`,
        address: `${quartier}, ${address}`,
        phone,
        payment_method: paymentMethod,
        photos: [],
        location: { type: 'Point', coordinates: [0, 0] },  // Will be updated with real GPS
      };

      const response = await api.post('/requests', requestData);
      
      router.push({
        pathname: '/booking-confirmation',
        params: {
          bookingId: response.data._id,
          artisanName,
          serviceName,
          servicePrice,
        }
      });
    } catch (error: any) {
      console.error('Failed to create booking:', error);
      Alert.alert(
        'Erreur',
        error.response?.data?.detail || 'Impossible de créer la réservation'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Passage en caisse</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary Card */}
          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>Récapitulatif</Text>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Service :</Text>
              <Text style={styles.summaryValue}>{serviceName}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Artisan :</Text>
              <Text style={styles.summaryValue}>{artisanName}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Prix :</Text>
              <Text style={styles.priceSummary}>{servicePrice} FCFA</Text>
            </View>
          </View>

          {/* Client Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Informations de livraison</Text>
            
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Quartier *</Text>
              <TextInput
                style={styles.input}
                value={quartier}
                onChangeText={setQuartier}
                placeholder="Ex: Cocody, Angré"
                placeholderTextColor={COLORS.textLight}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Adresse complète *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={address}
                onChangeText={setAddress}
                placeholder="Ex: Villa 123, Rue des Palmiers"
                placeholderTextColor={COLORS.textLight}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Numéro de téléphone *</Text>
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
              <Text style={styles.label}>Instructions supplémentaires (optionnel)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Précisions, accès, horaires..."
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
                  onPress={() => setPaymentMethod(method.id)}
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
            style={[styles.confirmButton, loading && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Text style={styles.confirmButtonText}>Confirmer la réservation</Text>
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
    backgroundColor: COLORS.light,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: COLORS.white,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 5,
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.dark,
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  summaryCard: {
    backgroundColor: `${COLORS.primary}15`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: COLORS.dark,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    flex: 1,
    textAlign: 'right',
  },
  priceSummary: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.light,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: COLORS.dark,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  paymentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  paymentCard: {
    width: '48%',
    backgroundColor: COLORS.light,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  paymentCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
  },
  paymentIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  paymentIconContainerSelected: {
    backgroundColor: `${COLORS.primary}20`,
  },
  paymentName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.dark,
    textAlign: 'center',
  },
  paymentNameSelected: {
    color: COLORS.primary,
  },
  checkmark: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -3,
    },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 10,
  },
  confirmButton: {
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
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
});
