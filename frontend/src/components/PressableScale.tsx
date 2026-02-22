import React from 'react';
import { ViewStyle, StyleProp, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

/**
 * PressableScale — Animated pressable wrapper.
 *
 * Scales down to `scaleValue` (default 0.97) on press and springs back to 1.0.
 * Drop-in replacement for TouchableOpacity with a more tactile feel.
 *
 * Usage:
 *   <PressableScale onPress={handlePress}>
 *     <MyCard />
 *   </PressableScale>
 */

interface PressableScaleProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Scale factor on press. Default 0.97 */
  scaleValue?: number;
  /** Accessibility label for screen readers */
  accessibilityLabel?: string;
  /** Accessibility hint for screen readers */
  accessibilityHint?: string;
  /** Test ID for testing */
  testID?: string;
}

const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
  mass: 0.5,
};

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

export default function PressableScale({
  children,
  onPress,
  onLongPress,
  style,
  disabled = false,
  scaleValue = 0.97,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled) {
      scale.value = withSpring(scaleValue, SPRING_CONFIG);
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, SPRING_CONFIG);
  };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <Animated.View style={[style, animatedStyle, disabled && { opacity: 0.5 }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
