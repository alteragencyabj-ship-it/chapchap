import { useEffect, useRef } from 'react';
import { View, Text, Platform, Animated } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store/authStore';
import { useMissionStore } from '../../src/store/missionStore';
import { useNotificationStore } from '../../src/store/notificationStore';
import { COLORS } from '../../src/config/constants';

/** Shared badge style for mission count and unread messages */
const badgeStyle = {
  position: 'absolute' as const,
  top: -4,
  right: -8,
  backgroundColor: COLORS.error,
  borderRadius: 9,
  minWidth: 18,
  height: 18,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  paddingHorizontal: 4,
  borderWidth: 2,
  borderColor: COLORS.white,
};

const badgeTextStyle = {
  color: COLORS.white,
  fontSize: 11,
  fontWeight: '700' as const,
};

function formatBadge(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/** Renders a count badge with optional pulse animation */
function BadgeView({ count, animated }: { count: number; animated?: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();
    animRef.current = null;

    if (animated && count > 0) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.0,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      );
      animRef.current = pulse;
      pulse.start();
    } else {
      scale.setValue(1);
    }
    return () => {
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [count, animated, scale]);

  if (count <= 0) return null;

  const badge = (
    <View style={badgeStyle}>
      <Text style={badgeTextStyle}>{formatBadge(count)}</Text>
    </View>
  );

  if (animated) {
    return (
      <Animated.View style={{ position: 'absolute', top: -4, right: -8, transform: [{ scale }] }}>
        <View style={[badgeStyle, { position: 'relative', top: 0, right: 0 }]}>
          <Text style={badgeTextStyle}>{formatBadge(count)}</Text>
        </View>
      </Animated.View>
    );
  }

  return badge;
}

export default function TabsLayout() {
  const user = useAuthStore((state) => state.user);
  const isArtisan = user?.role === 'artisan';
  const newMissionCount = useMissionStore((s) => s.newMissionCount);
  const fetchMissionCount = useMissionStore((s) => s.fetchCount);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);

  useEffect(() => {
    if (isArtisan) {
      fetchMissionCount();
      const interval = setInterval(fetchMissionCount, 30000);
      return () => clearInterval(interval);
    }
  }, [isArtisan, fetchMissionCount]);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  const floatingTabBarStyle = {
    position: 'absolute' as const,
    bottom: 30,
    left: 20,
    right: 20,
    elevation: 8,
    backgroundColor: COLORS.white,
    borderRadius: 35,
    height: 70,
    borderTopWidth: 0,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
    paddingTop: 10,
  };

  /** Chat tab icon with unread badge (shared between artisan and client) */
  const chatTabIcon = ({ color, focused }: { color: string; size: number; focused: boolean }) => (
    <View>
      <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={24} color={color} />
      <BadgeView count={unreadCount} />
    </View>
  );

  if (isArtisan) {
    return (
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: COLORS.iconSteel,
          tabBarInactiveTintColor: COLORS.textLight,
          headerShown: false,
          tabBarStyle: floatingTabBarStyle,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginBottom: Platform.OS === 'android' ? 8 : 0,
          },
          tabBarItemStyle: {
            borderRadius: 35,
          }
        }}
        screenListeners={{
          tabPress: () => { Haptics.selectionAsync(); },
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
              <View>
                <Ionicons name={focused ? "briefcase" : "briefcase-outline"} size={24} color={color} />
                <BadgeView count={newMissionCount} animated />
              </View>
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
            tabBarIcon: chatTabIcon,
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
        tabBarActiveTintColor: COLORS.iconSteel,
        tabBarInactiveTintColor: COLORS.textLight,
        headerShown: false,
        tabBarStyle: floatingTabBarStyle,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginBottom: Platform.OS === 'android' ? 8 : 0,
        },
        tabBarItemStyle: {
          borderRadius: 35,
        },
      }}
      screenListeners={{
        tabPress: () => { Haptics.selectionAsync(); },
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
          title: 'Activites',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "receipt" : "receipt-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Chat',
          tabBarIcon: chatTabIcon,
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
