import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';
import { COLORS } from '../src/config/constants';

export default function Index() {
  const router = useRouter();
  const { isLoading } = useAuthStore();

  useEffect(() => {
    if (!isLoading) {
      // Always go to welcome screen first
      // This allows users to choose between demo mode or login
      router.replace('/(auth)/welcome');
    }
  }, [isLoading]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.text}>Servicio</Text>
      <Text style={styles.slogan}>L'excellence à la demande.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  text: {
    marginTop: 20,
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
    letterSpacing: 1,
  },
  slogan: {
    marginTop: 8,
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.9,
  },
});