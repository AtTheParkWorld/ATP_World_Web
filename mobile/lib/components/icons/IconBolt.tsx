/**
 * Lightning bolt — flashes opacity every ~2.5 seconds. Used in
 * "Connect wearable" prompts + "Live now" CTAs where we want a hint
 * of urgency without screaming for attention.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, withDelay, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function IconBolt({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = true }: IconProps) {
  const o = useSharedValue(1);

  useEffect(() => {
    if (!active) { cancelAnimation(o); o.value = 1; return; }
    o.value = withRepeat(
      withSequence(
        withDelay(2000, withTiming(0.25, { duration: 120, easing: Easing.in(Easing.cubic) })),
        withTiming(1, { duration: 120 }),
        withTiming(0.4, { duration: 80 }),
        withTiming(1, { duration: 100 }),
      ),
      -1
    );
    return () => cancelAnimation(o);
  }, [active, o]);

  const animatedProps = useAnimatedProps(() => ({ opacity: o.value }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedPath
        d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        fill={color}
        fillOpacity={0.15}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
