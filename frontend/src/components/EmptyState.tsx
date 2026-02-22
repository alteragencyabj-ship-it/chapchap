import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, TYPOGRAPHY, SPACING, RADII } from '../config/constants';

/**
 * EmptyState — Centered placeholder for empty lists/screens.
 *
 * Renders an icon in a subtle circular background, a title, a subtitle,
 * and an optional call-to-action button.
 *
 * Usage:
 *   <EmptyState
 *     icon="document-text-outline"
 *     title="Aucune demande"
 *     subtitle="Creez votre premiere demande pour trouver un artisan"
 *     actionLabel="Creer une demande"
 *     onAction={() => router.push('/create-request')}
 *   />
 */

interface EmptyStateProps {
  /** Ionicons icon name */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Main heading */
  title: string;
  /** Description below the title */
  subtitle: string;
  /** Optional CTA button label */
  actionLabel?: string;
  /** Callback when the CTA button is pressed */
  onAction?: () => void;
}

export default function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={40} color={COLORS.textLight} />
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {actionLabel && onAction && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onAction}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING['3xl'],
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.neutral100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  title: {
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textLight,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
  },
  actionButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING['2xl'],
    paddingVertical: SPACING.md,
    borderRadius: RADII.md,
    marginTop: SPACING['2xl'],
  },
  actionText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
