/**
 * Tab-bar Profile icon — person silhouette (head + shoulders curve)
 * inside a soft aura ring. When active the aura pulses outward,
 * reading as "presence broadcasting" — way clearer than concentric
 * arcs (which read as WiFi).
 *
 * Head: clean circle. Shoulders: U-shaped curve, rounded ends.
 * Aura: outer ring that fades 1.0 → 0.2 → 1.0 in a 1.2s cycle.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function IconTabProfile({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const pulse = useSharedValue(0.9);

  useEffect(() => {
    if (!active) { cancelAnimation(pulse); pulse.value = 0; return; }
    const cfg = { duration: 700, easing: Easing.inOut(Easing.cubic) };
    pulse.value = withRepeat(withSequence(withTiming(0.2, cfg), withTiming(0.9, cfg)), -1);
    return () => cancelAnimation(pulse);
  }, [active, pulse]);

  const auraProps = useAnimatedProps(() => ({
    opacity: pulse.value,
  } as any));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Aura — only visible (and pulsing) when active */}
      <AnimatedCircle
        cx="12" cy="12"
        r="10.5"
        stroke={color}
        strokeWidth={1.1}
        animatedProps={auraProps}
      />
      {/* Head */}
      <Circle
        cx="12" cy="9.5"
        r="3.2"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {/* Shoulders */}
      <Path
        d="M5.5 19.5a6.5 6.5 0 0 1 13 0"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
