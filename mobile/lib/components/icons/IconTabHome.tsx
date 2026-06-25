/**
 * Tab-bar Home icon — house with two sparkle stars above. When active,
 * the sparkles twinkle in alternation (staggered opacity pulse). Reads
 * as "your park, your space" — alive, welcoming, never static.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function IconTabHome({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const sA = useSharedValue(1);
  const sB = useSharedValue(0.4);

  useEffect(() => {
    if (!active) { cancelAnimation(sA); cancelAnimation(sB); sA.value = 1; sB.value = 1; return; }
    const cfg = { duration: 700, easing: Easing.inOut(Easing.cubic) };
    sA.value = withRepeat(withSequence(withTiming(0.3, cfg), withTiming(1, cfg)), -1);
    sB.value = withRepeat(withSequence(withTiming(1, cfg),   withTiming(0.3, cfg)), -1);
    return () => { cancelAnimation(sA); cancelAnimation(sB); };
  }, [active, sA, sB]);

  const propsA = useAnimatedProps(() => ({ opacity: sA.value } as any));
  const propsB = useAnimatedProps(() => ({ opacity: sB.value } as any));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* House outline */}
      <Path
        d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-8Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Two sparkles above-left and above-right */}
      <AnimatedCircle cx="5"  cy="5" r="1.1" fill={color} animatedProps={propsA} />
      <AnimatedCircle cx="19" cy="4" r="0.9" fill={color} animatedProps={propsB} />
    </Svg>
  );
}
