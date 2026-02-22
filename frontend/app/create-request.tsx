import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  StatusBar,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { COLORS, SERVICE_CATEGORIES, SHADOWS, SPACING, RADII, TYPOGRAPHY } from '../src/config/constants';
import api from '../src/services/api';

export default function CreateRequest() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Form data
  const [serviceType, setServiceType] = useState(params.serviceType as string || '');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [budget, setBudget] = useState('');

  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });

        // Reverse geocoding to get address
        const addresses = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });

        if (addresses[0]) {
          const addr = addresses[0];
          setAddress(`${addr.street || ''}, ${addr.city || ''}, ${addr.country || ''}`.trim());
        }
      }
    } catch (error) {
      console.error('Location error:', error);
    }
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusee', 'Nous avons besoin d\'acceder a vos photos');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        setPhotos([...photos, `data:image/jpeg;base64,${result.assets[0].base64}`]);
      }
    } catch (error) {
      console.error('Image picker error:', error);
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusee', 'Nous avons besoin d\'acceder a votre camera');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        setPhotos([...photos, `data:image/jpeg;base64,${result.assets[0].base64}`]);
      }
    } catch (error) {
      console.error('Camera error:', error);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };

  const handleNext = () => {
    if (step === 1 && !serviceType) {
      Alert.alert('Erreur', 'Veuillez selectionner un service');
      return;
    }
    if (step === 2 && !description.trim()) {
      Alert.alert('Erreur', 'Veuillez decrire votre besoin');
      return;
    }
    if (step === 4 && !address.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir une adresse');
      return;
    }
    setStep(step + 1);
  };

  const handleSubmit = async () => {
    if (!location) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Localisation requise', 'Veuillez activer la localisation pour continuer.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      await api.post('/requests', {
        service_type: serviceType,
        description,
        photos,
        address,
        location: {
          type: 'Point',
          coordinates: [location.longitude, location.latitude],
        },
        budget: budget ? parseFloat(budget) : null,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Demande envoyee !', 'Votre demande a ete creee avec succes. Un artisan vous contactera bientot.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/my-requests') },
      ]);
    } catch (error: any) {
      Alert.alert('Erreur', error.response?.data?.detail || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Quel service recherchez-vous ?</Text>
            <View style={styles.servicesGrid}>
              {SERVICE_CATEGORIES.map((service) => (
                <TouchableOpacity
                  key={service.id}
                  style={[
                    styles.serviceCard,
                    serviceType === service.id && styles.serviceCardActive,
                  ]}
                  onPress={() => { Haptics.selectionAsync(); setServiceType(service.id); }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={service.icon as any}
                    size={32}
                    color={serviceType === service.id ? COLORS.white : COLORS.primary}
                  />
                  <Text
                    style={[
                      styles.serviceName,
                      serviceType === service.id && styles.serviceNameActive,
                    ]}
                  >
                    {service.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );

      case 2:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Decrivez votre besoin</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Decrivez en detail ce dont vous avez besoin..."
              placeholderTextColor={COLORS.textLight}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={8}
              textAlignVertical="top"
            />
          </View>
        );

      case 3:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Ajoutez des photos</Text>
            <Text style={styles.stepSubtitle}>Les photos aident les artisans a mieux comprendre</Text>

            <View style={styles.photoActions}>
              <TouchableOpacity style={styles.photoButton} onPress={takePhoto} activeOpacity={0.7}>
                <Ionicons name="camera" size={24} color={COLORS.primary} />
                <Text style={styles.photoButtonText}>Prendre une photo</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.photoButton} onPress={pickImage} activeOpacity={0.7}>
                <Ionicons name="images" size={24} color={COLORS.primary} />
                <Text style={styles.photoButtonText}>Galerie</Text>
              </TouchableOpacity>
            </View>

            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosContainer}>
                {photos.map((photo, index) => (
                  <View key={index} style={styles.photoItem}>
                    <Image source={{ uri: photo }} style={styles.photoImage} />
                    <TouchableOpacity
                      style={styles.removePhotoButton}
                      onPress={() => removePhoto(index)}
                    >
                      <Ionicons name="close-circle" size={24} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        );

      case 4:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Ou se situe l'intervention ?</Text>
            <TextInput
              style={styles.input}
              placeholder="Adresse complete"
              placeholderTextColor={COLORS.textLight}
              value={address}
              onChangeText={setAddress}
              multiline
            />
            {location && (
              <View style={styles.locationInfo}>
                <Ionicons name="location" size={20} color={COLORS.success} />
                <Text style={styles.locationText}>Localisation GPS activee</Text>
              </View>
            )}
          </View>
        );

      case 5:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Budget (optionnel)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 50000"
              placeholderTextColor={COLORS.textLight}
              value={budget}
              onChangeText={setBudget}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>Indiquez un budget estimatif en FCFA</Text>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => step > 1 ? setStep(step - 1) : router.back()}
            style={styles.backButton}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={24} color={COLORS.dark} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Nouvelle demande</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Step indicator */}
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progress, { width: `${(step / 5) * 100}%` }]} />
          </View>
          <Text style={styles.stepCounter}>Etape {step}/5</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {renderStep()}
        </ScrollView>

        <View style={styles.footer}>
          {step < 5 ? (
            <TouchableOpacity style={styles.nextButton} onPress={handleNext} activeOpacity={0.8}>
              <Text style={styles.nextButtonText}>Suivant</Text>
              <Ionicons name="arrow-forward" size={20} color={COLORS.white} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Text style={styles.submitButtonText}>Creer la demande</Text>
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 44,
  },
  progressBarContainer: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.white,
  },
  progressBar: {
    height: 4,
    backgroundColor: COLORS.neutral100,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progress: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  stepCounter: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xs,
    textAlign: 'right',
  },
  content: {
    flexGrow: 1,
    padding: SPACING.xl,
  },
  stepContainer: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.dark,
    marginBottom: SPACING.sm,
    lineHeight: 30,
  },
  stepSubtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
    marginBottom: SPACING['2xl'],
  },
  servicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    marginTop: SPACING.lg,
  },
  serviceCard: {
    width: '47%',
    backgroundColor: COLORS.neutral50,
    borderRadius: RADII.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.md,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 100,
  },
  serviceCardActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  serviceName: {
    ...TYPOGRAPHY.label,
    textAlign: 'center',
  },
  serviceNameActive: {
    color: COLORS.white,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: SPACING.lg,
    fontSize: 16,
    color: COLORS.dark,
    backgroundColor: COLORS.neutral50,
    marginTop: SPACING.lg,
  },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: SPACING.lg,
    fontSize: 16,
    color: COLORS.dark,
    backgroundColor: COLORS.neutral50,
    minHeight: 200,
    marginTop: SPACING.lg,
  },
  photoActions: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  photoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    padding: SPACING.lg,
    borderRadius: RADII.md,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    minHeight: 56,
  },
  photoButtonText: {
    color: COLORS.primary,
    ...TYPOGRAPHY.label,
  },
  photosContainer: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  photoItem: {
    position: 'relative',
    marginRight: SPACING.md,
  },
  photoImage: {
    width: 120,
    height: 120,
    borderRadius: RADII.md,
  },
  removePhotoButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: COLORS.white,
    borderRadius: 12,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: `${COLORS.success}12`,
    borderRadius: RADII.sm,
  },
  locationText: {
    ...TYPOGRAPHY.body,
    color: COLORS.dark,
  },
  hint: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.sm,
  },
  footer: {
    padding: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  nextButton: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 52,
  },
  nextButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.lg,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    minHeight: 52,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
});
