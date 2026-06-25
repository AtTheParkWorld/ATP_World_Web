/**
 * Heart — beats like a real one (lub-dub at ~70 bpm). Scale pulses
 * 1.0 → 1.15 → 1.0 → 1.08 → 1.0 in 850ms. Used in Supporter / Be a
 * Supporter contexts; the beat creates an emotional pull beyond a
 * flat icon.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconHeart({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = true }: IconProps) {
  const s = useSharedValue(1);

  useEffect(() => {
    if (!active) { cancelAnimation(s); s.value = 1; return; }
    const fast = { duration: 110, easing: Easing.out(Easing.cubic) };
    const slow = { duration: 180, easing: Easing.inOut(Easing.cubic) };
    s.value = withRepeat(
      withSequence(
        withTiming(1.15, fast),     // lub
        withTiming(1.0, slow),
        withTiming(1.08, fast),     // dub
        withTiming(1.0, slow),
        withTiming(1.0, { duration: 280 }),  // rest
      ),
      -1
    );
    return () => cancelAnimation(s);
  }, [active, s]);

  const animatedProps = useAnimatedProps(() => ({
    transform: [{ translateX: 12 }, { translateY: 12 }, { scale: s.value }, { translateX: -12 }, { translateY: -12 }] as any,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={animatedProps}>
        <Path
          d="M12 20.5s-7-4.5-7-10.5a5 5 0 0 1 7-4.6A5 5 0 0 1 19 10c0 6-7 10.5-7 10.5Z"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      </AnimatedG>
    </Svg>
  );
}
