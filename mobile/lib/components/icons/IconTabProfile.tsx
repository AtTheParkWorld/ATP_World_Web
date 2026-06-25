/**
 * Tab-bar Profile icon — three concentric arcs radiating from a centre
 * dot, like a signal badge. When active, the arcs ripple outward
 * sequentially (inner → middle → outer opacity pulse), suggesting a
 * member presence broadcasting outward. Way more on-brand than a flat
 * silhouette.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, withDelay, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function IconTabProfile({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const a1 = useSharedValue(1);
  const a2 = useSharedValue(1);
  const a3 = useSharedValue(1);

  useEffect(() => {
    if (!active) {
      cancelAnimation(a1); cancelAnimation(a2); cancelAnimation(a3);
      a1.value = a2.value = a3.value = 1;
      return;
    }
    const cycle = 1200;
    const half  = cycle / 2;
    const cfg   = { duration: half, easing: Easing.inOut(Easing.cubic) };
    a1.value = withRepeat(withSequence(withTiming(0.3, cfg), withTiming(1, cfg)), -1);
    a2.value = withDelay(150, withRepeat(withSequence(withTiming(0.3, cfg), withTiming(1, cfg)), -1));
    a3.value = withDelay(300, withRepeat(withSequence(withTiming(0.3, cfg), withTiming(1, cfg)), -1));
    return () => { cancelAnimation(a1); cancelAnimation(a2); cancelAnimation(a3); };
  }, [active, a1, a2, a3]);

  const p1 = useAnimatedProps(() => ({ opacity: a1.value } as any));
  const p2 = useAnimatedProps(() => ({ opacity: a2.value } as any));
  const p3 = useAnimatedProps(() => ({ opacity: a3.value } as any));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="14" r="1.8" fill={color} />
      <AnimatedPath d="M9 14a3 3 0 0 1 6 0"   stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" animatedProps={p1} />
      <AnimatedPath d="M6 14a6 6 0 0 1 12 0"  stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" animatedProps={p2} />
      <AnimatedPath d="M3 14a9 9 0 0 1 18 0"  stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" animatedProps={p3} />
    </Svg>
  );
}
