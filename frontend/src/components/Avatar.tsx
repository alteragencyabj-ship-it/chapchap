import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../config/constants';

/**
 * Avatar — Circular avatar with initials fallback and optional verified badge.
 *
 * If `imageUri` is provided, renders the image in a circle.
 * On image load error, falls back to initials automatically.
 * Shows a loading indicator while image loads.
 *
 * Usage:
 *   <Avatar name="Moussa Kone" size={48} />
 *   <Avatar name="Awa" imageUri="https://..." size={56} showVerified />
 */

interface AvatarProps {
  /** Full name — used for initials and color generation */
  name: string;
  /** Optional image URI */
  imageUri?: string;
  /** Diameter in pixels. Default 48 */
  size?: number;
  /** Show a blue verified shield overlay. Default false */
  showVerified?: boolean;
  /** Show a small colored badge overlay (e.g. online indicator). Default false */
  showBadge?: boolean;
}

// Deterministic background colors derived from a name hash.
const AVATAR_PALETTE = [
  '#63786A', // sage
  '#667389', // steel
  '#7A715D', // sand
  '#7F6666', // rose
  '#687F88', // ice
  '#5E5CE6', // indigo
  '#BF5AF2', // purple
  '#FF9F0A', // orange
];

/** Simple string hash -> palette index */
function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % AVATAR_PALETTE.length;
}

/** Extract up to 2 initials from a name, with safe fallback */
function getInitials(name: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0][0];
    const last = parts[parts.length - 1][0];
    if (first && last) {
      return (first + last).toUpperCase();
    }
  }
  return (parts[0]?.[0] || '?').toUpperCase();
}

export default function Avatar({
  name,
  imageUri,
  size = 48,
  showVerified = false,
  showBadge = false,
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(!!imageUri);

  const safeName = name || '';
  const bgColor = AVATAR_PALETTE[hashName(safeName)];
  const initials = getInitials(safeName);
  const fontSize = Math.round(size * 0.38);
  const borderRadius = size / 2;

  // Verified badge dimensions scale with avatar size
  const badgeSize = Math.max(16, Math.round(size * 0.32));
  const badgeIconSize = Math.round(badgeSize * 0.7);

  const shouldShowImage = !!imageUri && !imageError;

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoading(false);
  }, []);

  const handleImageLoad = useCallback(() => {
    setImageLoading(false);
  }, []);

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityLabel={`Avatar de ${safeName || 'utilisateur'}`}
      accessibilityRole="image"
    >
      {shouldShowImage ? (
        <View>
          <Image
            source={{ uri: imageUri }}
            style={{
              width: size,
              height: size,
              borderRadius,
            }}
            onError={handleImageError}
            onLoad={handleImageLoad}
          />
          {imageLoading && (
            <View
              style={[
                styles.loadingOverlay,
                {
                  width: size,
                  height: size,
                  borderRadius,
                  backgroundColor: bgColor,
                },
              ]}
            >
              <ActivityIndicator size="small" color={COLORS.white} />
            </View>
          )}
        </View>
      ) : (
        <View
          style={[
            styles.initialsContainer,
            {
              width: size,
              height: size,
              borderRadius,
              backgroundColor: bgColor,
            },
          ]}
        >
          <Text style={[styles.initialsText, { fontSize }]}>{initials}</Text>
        </View>
      )}

      {showVerified && (
        <View
          style={[
            styles.verifiedBadge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
            },
          ]}
          accessibilityLabel="Verifie"
        >
          <Ionicons name="shield-checkmark" size={badgeIconSize} color={COLORS.info} />
        </View>
      )}

      {showBadge && (
        <View
          style={[
            styles.onlineBadge,
            {
              width: Math.round(size * 0.22),
              height: Math.round(size * 0.22),
              borderRadius: Math.round(size * 0.11),
              borderWidth: 2,
              borderColor: COLORS.white,
            },
          ]}
          accessibilityLabel="En ligne"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  initialsContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.success,
  },
});
