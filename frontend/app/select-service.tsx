import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SERVICES_DATA } from '../src/config/constants';

interface Service {
  id: string;
  name: string;
  price: string;
  unit: string;
  category?: string;
}

export default function SelectService() {
  const router = useRouter();
  const { categoryId, categoryName } = useLocalSearchParams();
  
  const services: Service[] = SERVICES_DATA[categoryId as keyof typeof SERVICES_DATA] || [];

  const handleServiceSelect = (service: Service) => {
    router.push({
      pathname: '/select-artisan',
      params: {
        serviceId: service.id,
        serviceName: service.name,
        servicePrice: service.price,
        categoryId: categoryId,
      }
    });
  };

  // Fonction pour obtenir une icône basée sur le nom du service
  const getServiceIcon = (serviceName: string): any => {
    const name = serviceName.toLowerCase();
    if (name.includes('nettoyage') || name.includes('ménage')) return 'sparkles';
    if (name.includes('fuite') || name.includes('robinet') || name.includes('lavabo')) return 'water';
    if (name.includes('wc') || name.includes('débouchage')) return 'construct';
    if (name.includes('électr') || name.includes('ampoule') || name.includes('prise')) return 'flash';
    if (name.includes('tv') || name.includes('frigo') || name.includes('clim')) return 'desktop';
    if (name.includes('meuble') || name.includes('fixer') || name.includes('monter')) return 'hammer';
    if (name.includes('roue') || name.includes('batterie') || name.includes('véhicule')) return 'car';
    if (name.includes('laver') || name.includes('repassage')) return 'shirt';
    if (name.includes('consultation')) return 'people';
    return 'build';
  };

  // Fonction pour obtenir une variante de taille aléatoire mais cohérente
  const getBubbleSize = (index: number) => {
    const sizes = ['small', 'medium', 'large', 'medium', 'small', 'large'];
    return sizes[index % sizes.length];
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{categoryName}</Text>
      </View>

      <ScrollView 
        contentContainerStyle={styles.bubblesContainer}
        showsVerticalScrollIndicator={false}
      >
        {services.map((service, index) => {
          const bubbleSize = getBubbleSize(index);
          return (
            <TouchableOpacity
              key={service.id}
              style={[
                styles.bubble,
                bubbleSize === 'small' && styles.bubbleSmall,
                bubbleSize === 'medium' && styles.bubbleMedium,
                bubbleSize === 'large' && styles.bubbleLarge,
                // Alterne les positions pour créer un effet décalé
                index % 3 === 0 && styles.bubbleLeft,
                index % 3 === 1 && styles.bubbleCenter,
                index % 3 === 2 && styles.bubbleRight,
              ]}
              onPress={() => handleServiceSelect(service)}
              activeOpacity={0.7}
            >
              <View style={styles.bubbleContent}>
                <View style={[
                  styles.iconContainer,
                  bubbleSize === 'small' && styles.iconContainerSmall,
                  bubbleSize === 'large' && styles.iconContainerLarge,
                ]}>
                  <Ionicons 
                    name={getServiceIcon(service.name)} 
                    size={bubbleSize === 'small' ? 24 : bubbleSize === 'large' ? 36 : 30} 
                    color={COLORS.primary} 
                  />
                </View>
                <Text 
                  style={[
                    styles.bubbleText,
                    bubbleSize === 'small' && styles.bubbleTextSmall,
                    bubbleSize === 'large' && styles.bubbleTextLarge,
                  ]} 
                  numberOfLines={3}
                >
                  {service.name}
                </Text>
                {service.price && (
                  <Text style={[
                    styles.bubblePrice,
                    bubbleSize === 'small' && styles.bubblePriceSmall,
                    bubbleSize === 'large' && styles.bubblePriceLarge,
                  ]}>
                    {service.price} {service.unit}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
    backgroundColor: COLORS.primary,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
    marginLeft: 16,
    flex: 1,
  },
  bubblesContainer: {
    padding: 20,
    paddingTop: 10,
    flexGrow: 1,
  },
  bubble: {
    backgroundColor: COLORS.white,
    borderRadius: 30,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  // Tailles variées
  bubbleSmall: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 24,
  },
  bubbleMedium: {
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderRadius: 28,
  },
  bubbleLarge: {
    paddingHorizontal: 28,
    paddingVertical: 22,
    borderRadius: 35,
  },
  // Positions décalées
  bubbleLeft: {
    alignSelf: 'flex-start',
    marginRight: '35%',
  },
  bubbleCenter: {
    alignSelf: 'center',
    marginHorizontal: '10%',
  },
  bubbleRight: {
    alignSelf: 'flex-end',
    marginLeft: '35%',
  },
  bubbleContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: `${COLORS.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  iconContainerSmall: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 8,
  },
  iconContainerLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 12,
  },
  bubbleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.dark,
    textAlign: 'center',
    marginBottom: 6,
    lineHeight: 18,
  },
  bubbleTextSmall: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 5,
  },
  bubbleTextLarge: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
  },
  bubblePrice: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.primary,
    textAlign: 'center',
  },
  bubblePriceSmall: {
    fontSize: 12,
  },
  bubblePriceLarge: {
    fontSize: 16,
  },
});