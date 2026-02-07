import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { COLORS } from '../../src/config/constants';
import { View, Platform } from 'react-native';

export default function TabsLayout() {
  const user = useAuthStore((state) => state.user);
  const isArtisan = user?.role === 'artisan';

  const floatingTabBarStyle = {
    position: 'absolute' as const,
    bottom: 30, // Floating high enough
    left: 20,
    right: 20,
    elevation: 8,
    backgroundColor: COLORS.white,
    borderRadius: 35, // Pill shape
    height: 70,
    borderTopWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, // Softer shadow
    shadowRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 20 : 10, // Adjust for OS
    paddingTop: 10,
  };

  if (isArtisan) {
    return (
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textLight,
          headerShown: false,
          tabBarStyle: floatingTabBarStyle,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginBottom: Platform.OS === 'android' ? 8 : 0,
          },
          tabBarItemStyle: {
            // Ensure touch target is good
            borderRadius: 35,
          }
        }}
      >
        <Tabs.Screen
          name="artisan-home"
          options={{
            title: 'Accueil',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "grid" : "grid-outline"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="my-missions"
          options={{
            title: 'Missions',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "briefcase" : "briefcase-outline"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="wallet"
          options={{
            title: 'Wallet',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "wallet" : "wallet-outline"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Chat',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "person" : "person-outline"} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen name="home" options={{ href: null }} />
        <Tabs.Screen name="my-requests" options={{ href: null }} />
      </Tabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textLight,
        headerShown: false,
        tabBarStyle: floatingTabBarStyle,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginBottom: Platform.OS === 'android' ? 8 : 0,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-requests"
        options={{
          title: 'Activités',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "receipt" : "receipt-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="artisan-home" options={{ href: null }} />
      <Tabs.Screen name="my-missions" options={{ href: null }} />
      <Tabs.Screen name="wallet" options={{ href: null }} />
    </Tabs>
  );
}
