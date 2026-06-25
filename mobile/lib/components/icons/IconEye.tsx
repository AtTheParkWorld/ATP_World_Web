/**
 * Eye — blinks every ~3 seconds. The upper lid path scaleY's down to
 * 0.05 then snaps back, simulating a blink. The pupil stays put so
 * the animation reads as the eye blinking rather than the whole icon
 * collapsing.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, withDelay, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconEye({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = true }: IconProps) {
  const lid = useSharedValue(1);

  useEffect(() => {
    if (!active) {
      cancelAnimation(lid);
      lid.value = 1;
      return;
    }
    // Open for 2.7s, blink down + back in 180ms, repeat forever
    lid.value = withRepeat(
      withSequence(
        withDelay(2700, withTiming(0.05, { duration: 90, easing: Easing.in(Easing.cubic) })),
        withTiming(1, { duration: 90, easing: Easing.out(Easing.cubic) }),
      ),
      -1
    );
    return () => cancelAnimation(lid);
  }, [active, lid]);

  const animatedProps = useAnimatedProps(() => ({
    // scaleY from 1 → 0.05 → 1; origin Y=12 (eye centre)
    transform: [{ translateY: 12 }, { scaleY: lid.value }, { translateY: -12 }] as any,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={animatedProps}>
        <Path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} />
      </AnimatedG>
    </Svg>
  );
}
