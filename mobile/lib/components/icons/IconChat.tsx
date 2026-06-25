/**
 * Chat bubble with animated typing dots inside. The three dots
 * bounce in sequence (each 200ms offset), exactly like Messages /
 * iMessage's "typing" indicator. Used for DM list rows + the
 * Community Comments button so the app feels alive.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, withDelay, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function dot(delay: number) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) }),
          withTiming(0, { duration: 250, easing: Easing.in(Easing.cubic) }),
          withDelay(400, withTiming(0, { duration: 0 })),  // pause before next cycle
        ),
        -1
      )
    );
    return () => cancelAnimation(t);
  }, [delay, t]);
  return t;
}

export function IconChat({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = true }: IconProps) {
  const d1 = dot(0);
  const d2 = dot(200);
  const d3 = dot(400);

  const props1 = useAnimatedProps(() => ({ cy: 13 - (active ? d1.value : 0) * 1.5 }));
  const props2 = useAnimatedProps(() => ({ cy: 13 - (active ? d2.value : 0) * 1.5 }));
  const props3 = useAnimatedProps(() => ({ cy: 13 - (active ? d3.value : 0) * 1.5 }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18v12H8l-5 4V6Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <AnimatedCircle cx="8"  cy="13" r="1.1" fill={color} animatedProps={props1} />
      <AnimatedCircle cx="12" cy="13" r="1.1" fill={color} animatedProps={props2} />
      <AnimatedCircle cx="16" cy="13" r="1.1" fill={color} animatedProps={props3} />
    </Svg>
  );
}
