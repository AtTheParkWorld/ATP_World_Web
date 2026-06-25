/**
 * Tab-bar Sessions icon — proper kettlebell: rectangular handle on top
 * with rounded corners, short neck, round bell. When active the whole
 * thing tilts gently left-right (-7° → +7°) like a swinging weight.
 * Reads unmistakably as fitness, no calendar metaphor.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconTabSessions({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const r = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(r); r.value = 0; return; }
    const cfg = { duration: 650, easing: Easing.inOut(Easing.cubic) };
    r.value = withRepeat(withSequence(withTiming(-7, cfg), withTiming(7, cfg)), -1, true);
    return () => cancelAnimation(r);
  }, [active, r]);

  const animatedProps = useAnimatedProps(() => ({
    transform: [{ translateX: 12 }, { translateY: 14 }, { rotate: `${r.value}deg` }, { translateX: -12 }, { translateY: -14 }] as any,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={animatedProps}>
        {/* Handle — rounded rectangle on top */}
        <Path
          d="M9 3.5h6a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {/* Neck — short straight segments connecting handle to bell */}
        <Path d="M9.5 9v1.2M14.5 9v1.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        {/* Bell — solid circle for clarity */}
        <Circle cx="12" cy="15.5" r="5" stroke={color} strokeWidth={strokeWidth} />
        {/* Small highlight dot on bell — adds premium detail */}
        <Circle cx="10" cy="14" r="0.8" fill={color} />
      </AnimatedG>
    </Svg>
  );
}
