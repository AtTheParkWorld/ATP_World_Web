/**
 * Bell — shakes when `active` is true (unread present). 12° rotation
 * left-right with damped wobble, twice every 4 seconds. Tactile +
 * brief, matches iOS Mail's badge pulse rhythm.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, withDelay, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconNotification({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const rot = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(rot); rot.value = 0; return; }
    rot.value = withRepeat(
      withSequence(
        withTiming(12,  { duration: 90, easing: Easing.out(Easing.cubic) }),
        withTiming(-10, { duration: 120 }),
        withTiming(8,   { duration: 110 }),
        withTiming(-6,  { duration: 110 }),
        withTiming(0,   { duration: 120 }),
        withDelay(3000, withTiming(0, { duration: 0 })),  // rest before next shake
      ),
      -1
    );
    return () => cancelAnimation(rot);
  }, [active, rot]);

  const animatedProps = useAnimatedProps(() => ({
    transform: [{ translateX: 12 }, { rotate: `${rot.value}deg` }, { translateX: -12 }] as any,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={animatedProps}>
        <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2H4.5L6 16Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        <Path d="M10 20a2 2 0 0 0 4 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </AnimatedG>
    </Svg>
  );
}
