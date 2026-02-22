import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { COLORS, SPACING, RADII, SHADOWS } from '../config/constants';

/**
 * SkeletonLoader — Pulsing placeholder for loading states.
 *
 * Three layout variants match common UI patterns:
 * - 'card'      : Full-width card with header row + body lines
 * - 'list-item' : Compact row with circle + two text lines
 * - 'inline'    : Small inline rectangle (e.g. badge, tag)
 *
 * Usage:
 *   <SkeletonLoader variant="card" count={3} />
 *   <SkeletonLoader variant="list-item" />
 */

interface SkeletonLoaderProps {
  /** Layout variant */
  variant: 'card' | 'list-item' | 'inline';
  /** Number of skeleton items to render. Default 1 */
  count?: number;
}

/** Animated block that pulses opacity 0.3 -> 1.0 -> 0.3 */
function PulsingBlock({ style }: { style?: any }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1, // infinite
      true // reverse
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.block, style, animatedStyle]} />;
}

function CardSkeleton() {
  return (
    <View style={[styles.card, SHADOWS.sm]}>
      {/* Header row: circle + title lines */}
      <View style={styles.cardHeader}>
        <PulsingBlock style={styles.circle} />
        <View style={styles.cardHeaderLines}>
          <PulsingBlock style={[styles.line, { width: '60%' }]} />
          <PulsingBlock style={[styles.line, { width: '40%', height: 10 }]} />
        </View>
      </View>
      {/* Body lines */}
      <PulsingBlock style={[styles.line, { width: '100%', marginTop: SPACING.lg }]} />
      <PulsingBlock style={[styles.line, { width: '85%', marginTop: SPACING.sm }]} />
      <PulsingBlock style={[styles.line, { width: '70%', marginTop: SPACING.sm }]} />
    </View>
  );
}

function ListItemSkeleton() {
  return (
    <View style={styles.listItem}>
      <PulsingBlock style={styles.circle} />
      <View style={styles.listItemLines}>
        <PulsingBlock style={[styles.line, { width: '55%' }]} />
        <PulsingBlock style={[styles.line, { width: '80%', height: 10, marginTop: 6 }]} />
      </View>
    </View>
  );
}

function InlineSkeleton() {
  return <PulsingBlock style={styles.inlineBlock} />;
}

export default function SkeletonLoader({ variant, count = 1 }: SkeletonLoaderProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  const Component =
    variant === 'card'
      ? CardSkeleton
      : variant === 'list-item'
        ? ListItemSkeleton
        : InlineSkeleton;

  return (
    <View accessibilityLabel="Chargement en cours" accessibilityRole="progressbar">
      {items.map((i) => (
        <Component key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: COLORS.neutral200,
    borderRadius: RADII.sm,
  },

  // Card variant
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeaderLines: {
    flex: 1,
    marginLeft: SPACING.md,
  },

  // List-item variant
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  listItemLines: {
    flex: 1,
    marginLeft: SPACING.md,
  },

  // Shared shapes
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  line: {
    height: 14,
    borderRadius: 4,
  },

  // Inline variant
  inlineBlock: {
    width: 64,
    height: 24,
    borderRadius: RADII.sm,
  },
});
