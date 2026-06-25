/**
 * Tab-bar Community icon — heart with two small figure-dots inside
 * (representing "we move together"). When active, the heart beats
 * lub-dub at ~70 bpm. Same beat pattern as the in-app IconHeart so
 * supporter + community share visual rhythm.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconTabCommunity({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const s = useSharedValue(1);

  useEffect(() => {
    if (!active) { cancelAnimation(s); s.value = 1; return; }
    const fast = { duration: 110, easing: Easing.out(Easing.cubic) };
    const slow = { duration: 180, easing: Easing.inOut(Easing.cubic) };
    s.value = withRepeat(
      withSequence(
        withTiming(1.15, fast),
        withTiming(1.0,  slow),
        withTiming(1.08, fast),
        withTiming(1.0,  slow),
        withTiming(1.0,  { duration: 280 }),
      ),
      -1
    );
    return () => cancelAnimation(s);
  }, [active, s]);

  const animatedProps = useAnimatedProps(() => ({
    transform: [{ translateX: 12 }, { translateY: 13 }, { scale: s.value }, { translateX: -12 }, { translateY: -13 }] as any,
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
        {/* Two figure dots — "two together" */}
        <Circle cx="10" cy="11" r="1.1" fill={color} />
        <Circle cx="14" cy="11" r="1.1" fill={color} />
      </AnimatedG>
    </Svg>
  );
}
