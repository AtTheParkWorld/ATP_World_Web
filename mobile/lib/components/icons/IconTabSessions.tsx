/**
 * Tab-bar Sessions icon — kettlebell (semi-circular handle on top, bell
 * beneath). When active, the whole bell tilts left-right gently like
 * a swinging weight (-8° → +8°). Reads as "train, elevate" without
 * needing a calendar metaphor.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconTabSessions({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const r = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(r); r.value = 0; return; }
    const cfg = { duration: 650, easing: Easing.inOut(Easing.cubic) };
    r.value = withRepeat(withSequence(withTiming(-8, cfg), withTiming(8, cfg)), -1, true);
    return () => cancelAnimation(r);
  }, [active, r]);

  const animatedProps = useAnimatedProps(() => ({
    transform: [{ translateX: 12 }, { translateY: 14 }, { rotate: `${r.value}deg` }, { translateX: -12 }, { translateY: -14 }] as any,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={animatedProps}>
        {/* Handle */}
        <Path
          d="M8 6.5a4 4 0 0 1 8 0V8"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Yoke connecting handle to bell */}
        <Path
          d="M7 8.5h10"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Bell body */}
        <Path
          d="M6 9c0 6 2.5 10 6 10s6-4 6-10"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      </AnimatedG>
    </Svg>
  );
}
