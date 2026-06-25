/**
 * Flame — animated flicker when `active` is true (streak alive).
 * Subtle scale + opacity wobble that mimics a real flame at ~7Hz so
 * the icon feels warm without being distracting next to text.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function IconStreak({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = true }: IconProps) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (active) {
      t.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      cancelAnimation(t);
      t.value = 0;
    }
    return () => cancelAnimation(t);
  }, [active, t]);

  const animatedProps = useAnimatedProps(() => {
    // Flame opacity wobbles between 0.85 and 1.0
    const opacity = 0.85 + t.value * 0.15;
    return { opacity };
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedPath
        d="M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-5-2 2-4 4-4 8a7 7 0 0 0 14 0c0-5-5-7-7-11Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
