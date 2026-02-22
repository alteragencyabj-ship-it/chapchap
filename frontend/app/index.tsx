import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';
import { COLORS } from '../src/config/constants';

export default function Index() {
  const router = useRouter();
  const { isLoading, user } = useAuthStore();

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        // User already logged in — go to correct home
        if (user.role === 'artisan') {
          router.replace('/(tabs)/artisan-home');
        } else {
          router.replace('/(tabs)/home');
        }
      } else {
        router.replace('/(auth)/welcome');
      }
    }
  }, [isLoading, router, user]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.iconSteel} />
      <Text style={styles.text}>ARTISAN</Text>
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
