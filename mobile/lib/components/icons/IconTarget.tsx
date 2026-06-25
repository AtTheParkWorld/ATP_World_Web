/**
 * Target / bullseye — outer ring rotates clockwise slowly (one
 * revolution every 4 seconds), inner rings stay fixed. Reads as
 * "challenge in progress, keep tracking" — gentle but alive.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);

export function IconTarget({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = true }: IconProps) {
  const rot = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(rot); rot.value = 0; return; }
    rot.value = withRepeat(withTiming(360, { duration: 4000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rot);
  }, [active, rot]);

  const animatedProps = useAnimatedProps(() => ({
    transform: [{ translateX: 12 }, { translateY: 12 }, { rotate: `${rot.value}deg` }, { translateX: -12 }, { translateY: -12 }] as any,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={animatedProps}>
        <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} strokeDasharray="4 4" />
      </AnimatedG>
      <Circle cx="12" cy="12" r="5.5" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="12" cy="12" r="2"   fill={color} />
    </Svg>
  );
}
