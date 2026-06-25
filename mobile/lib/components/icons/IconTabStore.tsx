/**
 * Tab-bar Store icon — shopping bag with handle + a single sparkle
 * accent (the dot inside the bag echoes the wordmark's lime dot).
 * When active, the bag bounces gently (translateY -1 → 0) like it
 * was just placed down — premium gear feel, not a generic basket.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconTabStore({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const y = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(y); y.value = 0; return; }
    const up   = { duration: 320, easing: Easing.out(Easing.cubic) };
    const down = { duration: 380, easing: Easing.in(Easing.cubic) };
    y.value = withRepeat(withSequence(withTiming(-1.5, up), withTiming(0, down), withTiming(0, { duration: 400 })), -1);
    return () => cancelAnimation(y);
  }, [active, y]);

  const animatedProps = useAnimatedProps(() => ({
    transform: [{ translateY: y.value }] as any,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={animatedProps}>
        {/* Bag handle (arched) */}
        <Path
          d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Bag body */}
        <Path
          d="M5.5 8h13l-1 11.5a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9L5.5 8Z"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {/* Lime-dot echo of the ATP wordmark, sits centred on the bag */}
        <Circle cx="12" cy="14" r="1.4" fill={color} />
      </AnimatedG>
    </Svg>
  );
}
