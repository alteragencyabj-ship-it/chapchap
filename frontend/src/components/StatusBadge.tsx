import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { STATUS_COLORS, STATUS_LABELS, COLORS, RADII } from '../config/constants';

/**
 * StatusBadge — Pill-shaped colored badge for request/mission status.
 *
 * Automatically maps a status key to the correct color and French label
 * using the centralized STATUS_COLORS and STATUS_LABELS maps.
 *
 * Falls back to neutral gray + formatted status key for unknown statuses.
 *
 * Usage:
 *   <StatusBadge status="pending" />
 *   <StatusBadge status="en_cours" size="sm" />
 */

interface StatusBadgeProps {
  /** Status key (e.g. 'pending', 'en_cours', 'completed', 'annulee') */
  status: string;
  /** Badge size. Default 'md' */
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const normalizedStatus = (status || '').toLowerCase().trim();
  const color = STATUS_COLORS[normalizedStatus] || COLORS.neutral500;
  const label = STATUS_LABELS[normalizedStatus] || normalizedStatus.replace(/_/g, ' ') || 'Inconnu';

  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: color + '1A', // 10% opacity
          paddingHorizontal: isSmall ? 8 : 12,
          paddingVertical: isSmall ? 3 : 5,
        },
      ]}
      accessibilityLabel={`Statut: ${label}`}
      accessibilityRole="text"
    >
      <Text
        style={[
          styles.text,
          {
            color,
            fontSize: isSmall ? 10 : 12,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
