import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING } from '../config/constants';

/**
 * SectionHeader — Section title with optional right-aligned action link.
 *
 * Usage:
 *   <SectionHeader title="Artisans recommandes" />
 *   <SectionHeader
 *     title="Demandes recentes"
 *     actionLabel="Voir tout"
 *     onAction={() => router.push('/all-requests')}
 *   />
 */

interface SectionHeaderProps {
  /** Section title (left-aligned, h3 style) */
  title: string;
  /** Optional right-aligned action link label */
  actionLabel?: string;
  /** Callback when the action link is pressed */
  onAction?: () => void;
}

export default function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.container} accessibilityRole="header">
      <Text style={styles.title}>{title}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          onPress={onAction}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.action}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.h3,
    flex: 1,
  },
  action: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.info,
    marginLeft: SPACING.sm,
  },
});
