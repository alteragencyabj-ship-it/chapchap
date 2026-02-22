import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/services/api';
import { useSyncStore } from '../src/store/syncStore';
import { COLORS, RADII, SHADOWS, SPACING } from '../src/config/constants';

export default function RateMissionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    requestId?: string | string[];
    artisanId?: string | string[];
    serviceName?: string | string[];
  }>();
  const requestId = Array.isArray(params.requestId) ? params.requestId[0] : params.requestId;
  const artisanId = Array.isArray(params.artisanId) ? params.artisanId[0] : params.artisanId;
  const serviceNameRaw = Array.isArray(params.serviceName) ? params.serviceName[0] : params.serviceName;
  const serviceName = serviceNameRaw || 'Mission';

  const bumpSync = useSyncStore((s) => s.bumpSync);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => Boolean(requestId && artisanId && rating >= 1 && !submitting),
    [requestId, artisanId, rating, submitting],
  );

  const submit = async () => {
    if (!requestId || !artisanId) {
      Alert.alert('Erreur', 'Mission introuvable pour la notation.');
      return;
    }
    if (!rating) {
      Alert.alert('Note requise', 'Veuillez selectionner une note entre 1 et 5 etoiles.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/ratings', {
        request_id: requestId,
        artisan_id: artisanId,
        rating,
        comment: comment.trim() || 'Merci pour la mission.',
      });
      bumpSync('rating_submitted', { request_id: requestId });
      Alert.alert('Merci', 'Votre notation a bien ete enregistree.', [
        {
          text: 'OK',
          onPress: () => {
            router.replace({
              pathname: '/request-details',
              params: { requestId },
            });
          },
        },
      ]);
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail || "Impossible d'envoyer la notation.";
      if (status === 409) {
        Alert.alert('Deja notee', 'Cette mission a deja ete notee.', [
          {
            text: 'OK',
            onPress: () => {
              router.replace({
                pathname: '/request-details',
                params: { requestId },
              });
            },
          },
        ]);
        return;
      }
      Alert.alert('Erreur', detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.dark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Noter la mission</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.title}>Comment etait la prestation ?</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {serviceName}
            </Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRating(star)}
                  style={styles.starButton}
                  accessibilityRole="button"
                  accessibilityLabel={`${star} etoile${star > 1 ? 's' : ''}`}
                >
                  <Ionicons
                    name={star <= rating ? 'star' : 'star-outline'}
                    size={36}
                    color={star <= rating ? COLORS.warningBright : COLORS.neutral300}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              value={comment}
              onChangeText={setComment}
              placeholder="Ajoutez un commentaire (optionnel)"
              placeholderTextColor={COLORS.textLight}
              multiline
              maxLength={500}
            />
            <Text style={styles.counter}>{comment.length}/500</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={submit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
                <Text style={styles.submitText}>Envoyer la note</Text>
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
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.dark,
  },
  content: {
    flex: 1,
    padding: SPACING.xl,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.dark,
  },
  subtitle: {
    marginTop: SPACING.sm,
    fontSize: 14,
    color: COLORS.textLight,
  },
  starsRow: {
    marginTop: SPACING.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 44,
  },
  starButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    marginTop: SPACING.lg,
    minHeight: 110,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    textAlignVertical: 'top',
    color: COLORS.dark,
    fontSize: 15,
    lineHeight: 21,
    backgroundColor: COLORS.neutral50,
  },
  counter: {
    marginTop: SPACING.xs,
    textAlign: 'right',
    color: COLORS.textLight,
    fontSize: 12,
  },
  footer: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.md,
    backgroundColor: COLORS.neutral50,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.success,
    borderRadius: RADII.lg,
    paddingVertical: SPACING.md,
  },
  submitButtonDisabled: {
    opacity: 0.55,
  },
  submitText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
