/**
 * Live broadcast — concentric radial waves that pulse outward from
 * a centre dot. Three rings, staggered by 0.4s each, scaled + faded
 * over a 1.2s loop. Reads instantly as "broadcasting now".
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withTiming, Easing, withDelay, cancelAnimation } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function IconLive({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = true }: IconProps) {
  const r1 = useSharedValue(0);
  const r2 = useSharedValue(0);
  const r3 = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      [r1, r2, r3].forEach(cancelAnimation);
      r1.value = r2.value = r3.value = 0;
      return;
    }
    const cfg = { duration: 1400, easing: Easing.out(Easing.cubic) };
    r1.value = withRepeat(withTiming(1, cfg), -1, false);
    r2.value = withDelay(450, withRepeat(withTiming(1, cfg), -1, false));
    r3.value = withDelay(900, withRepeat(withTiming(1, cfg), -1, false));
    return () => [r1, r2, r3].forEach(cancelAnimation);
  }, [active, r1, r2, r3]);

  const ring = (t: any) => useAnimatedProps(() => ({
    r: 2 + t.value * 9,
    opacity: 1 - t.value,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="2" fill={color} />
      <AnimatedCircle cx="12" cy="12" stroke={color} strokeWidth={strokeWidth} animatedProps={ring(r1)} />
      <AnimatedCircle cx="12" cy="12" stroke={color} strokeWidth={strokeWidth} animatedProps={ring(r2)} />
      <AnimatedCircle cx="12" cy="12" stroke={color} strokeWidth={strokeWidth} animatedProps={ring(r3)} />
    </Svg>
  );
}
