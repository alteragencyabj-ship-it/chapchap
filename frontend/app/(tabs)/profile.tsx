import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '../../src/store/authStore';
import { COLORS, SHADOWS, SPACING, RADII, TYPOGRAPHY } from '../../src/config/constants';
import { useSyncStore } from '../../src/store/syncStore';
import { disconnectSocket } from '../../src/services/socket';

export default function Profile() {
  const router = useRouter();
  const { user, logout, refreshMe } = useAuthStore();
  const syncVersion = useSyncStore((s) => s.syncVersion);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (user?.role === 'artisan') {
      refreshMe();
    }
  }, [syncVersion, user?.role, refreshMe]);

  const handleLogout = () => {
    if (loggingOut) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Deconnexion',
      'Voulez-vous vraiment vous deconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se deconnecter',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              // Disconnect socket before clearing auth
              disconnectSocket();
              // Clear sync store
              useSyncStore.getState().bumpSync('logout');
              // Clear auth (token + user from AsyncStorage)
              await logout();
            } catch (e) {
              console.error('Logout error:', e);
            } finally {
              setLoggingOut(false);
              router.replace('/(auth)/welcome');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              <Ionicons
                name={user?.role === 'artisan' ? 'construct' : 'person'}
                size={48}
                color={COLORS.white}
              />
            </View>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>
              {user?.role === 'artisan' ? 'Artisan' : 'Client'}
            </Text>
          </View>
        </View>

        {user?.role === 'artisan' && (
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{user.average_rating?.toFixed(1) || '0.0'}</Text>
              <Text style={styles.statLabel}>Note moyenne</Text>
              <Ionicons name="star" size={24} color={COLORS.iconSand} />
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{user.total_missions || 0}</Text>
              <Text style={styles.statLabel}>Missions</Text>
              <Ionicons name="briefcase" size={24} color={COLORS.iconSage} />
            </View>
          </View>
        )}

        {user?.role === 'artisan' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profil artisan</Text>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/edit-profile-artisan')}
            >
              <Ionicons name="create-outline" size={24} color={COLORS.dark} />
              <Text style={styles.menuText}>Completer mon profil</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </TouchableOpacity>

            {user._id ? (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() =>
                  router.push({
                    pathname: '/artisan-profile',
                    params: { id: user._id },
                  })
                }
              >
                <Ionicons name="eye-outline" size={24} color={COLORS.dark} />
                <Text style={styles.menuText}>Voir ma fiche publique</Text>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            ) : null}

            <View style={styles.domainsCard}>
              <Text style={styles.domainsTitle}>Mes domaines de specialite</Text>
              <View style={styles.domainsWrap}>
                {(user?.specialty_domains || user?.specialties || []).length > 0 ? (
                  (user?.specialty_domains || user?.specialties || []).map((domain) => (
                    <View key={domain} style={styles.domainChip}>
                      <Text style={styles.domainChipText}>{domain}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.domainsEmpty}>Aucun domaine configure</Text>
                )}
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informations</Text>
          
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="call" size={20} color={COLORS.textLight} />
              <Text style={styles.infoText}>{user?.phone}</Text>
            </View>
            
            {user?.role === 'artisan' && user.specialties && (
              <View style={styles.infoRow}>
                <Ionicons name="hammer" size={20} color={COLORS.textLight} />
                <Text style={styles.infoText}>
                  {user.specialties.join(', ')}
                </Text>
              </View>
            )}
            
            {user?.role === 'artisan' && user.city && (
              <View style={styles.infoRow}>
                <Ionicons name="location" size={20} color={COLORS.textLight} />
                <Text style={styles.infoText}>{user.city}</Text>
              </View>
            )}
          </View>
        </View>

        {user?.role === 'admin' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Administration</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/admin-settle')}
            >
              <Ionicons name="shield-checkmark-outline" size={24} color={COLORS.iconSteel} />
              <Text style={styles.menuText}>Regulariser les commissions</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="settings-outline" size={24} color={COLORS.dark} />
            <Text style={styles.menuText}>Paramètres</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="help-circle-outline" size={24} color={COLORS.dark} />
            <Text style={styles.menuText}>Aide</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="information-circle-outline" size={24} color={COLORS.dark} />
            <Text style={styles.menuText}>À propos</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.logoutButton]}
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={24} color={COLORS.danger} />
            <Text style={[styles.menuText, { color: COLORS.danger }]}>Déconnexion</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>Version 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.light,
  },
  scrollContent: {
    paddingBottom: SPACING['3xl'],
  },
  header: {
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING['2xl'],
    paddingTop: SPACING['2xl'],
    paddingBottom: SPACING['2xl'],
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatarContainer: {
    marginBottom: SPACING.lg,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.md,
  },
  name: {
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.xs,
  },
  email: {
    ...TYPOGRAPHY.caption,
    fontSize: 14,
    marginBottom: SPACING.md,
  },
  roleBadge: {
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
  },
  roleText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.sm,
    ...SHADOWS.sm,
  },
  statValue: {
    ...TYPOGRAPHY.h1,
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
  },
  section: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: SPACING.md,
    marginLeft: SPACING.xs,
  },
  infoCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    gap: SPACING.lg,
    ...SHADOWS.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: 28,
  },
  infoText: {
    ...TYPOGRAPHY.body,
    fontSize: 14,
    flex: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    marginBottom: SPACING.sm,
    borderRadius: RADII.md,
    gap: SPACING.md,
    minHeight: 52,
    ...SHADOWS.sm,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    color: COLORS.dark,
  },
  logoutButton: {
    marginTop: SPACING.sm,
  },
  domainsCard: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: RADII.md,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  domainsTitle: {
    ...TYPOGRAPHY.label,
    fontSize: 14,
    marginBottom: SPACING.md,
  },
  domainsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  domainChip: {
    backgroundColor: COLORS.neutral100,
    borderRadius: RADII.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  domainChipText: {
    color: COLORS.dark,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  domainsEmpty: {
    ...TYPOGRAPHY.caption,
    fontSize: 13,
  },
  version: {
    textAlign: 'center',
    ...TYPOGRAPHY.caption,
    paddingVertical: SPACING.xl,
  },
});
