/**
 * Tab-bar Rewards icon — cut diamond / gem with internal facet lines
 * and two sparkle dots flanking it. When active, the sparkles twinkle
 * in alternation (staggered opacity pulse) — reads as "shimmer of
 * something valuable just unlocked", not a flat trophy.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function IconTabRewards({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const sA = useSharedValue(1);
  const sB = useSharedValue(0.3);

  useEffect(() => {
    if (!active) { cancelAnimation(sA); cancelAnimation(sB); sA.value = 1; sB.value = 1; return; }
    const cfg = { duration: 600, easing: Easing.inOut(Easing.cubic) };
    sA.value = withRepeat(withSequence(withTiming(0.3, cfg), withTiming(1, cfg)), -1);
    sB.value = withRepeat(withSequence(withTiming(1, cfg),   withTiming(0.3, cfg)), -1);
    return () => { cancelAnimation(sA); cancelAnimation(sB); };
  }, [active, sA, sB]);

  const propsA = useAnimatedProps(() => ({ opacity: sA.value } as any));
  const propsB = useAnimatedProps(() => ({ opacity: sB.value } as any));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gem outline */}
      <Path
        d="M7 5h10l3 4-8 11L4 9l3-4Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Facet lines */}
      <Path
        d="M4 9h16M10 5l2 4 2-4M12 9l-2 4M12 9l2 4"
        stroke={color}
        strokeWidth={Math.max(strokeWidth - 0.6, 1.5)}
        strokeLinejoin="round"
      />
      {/* Sparkle accents — twinkle when active */}
      <AnimatedCircle cx="3"  cy="5"  r="0.9" fill={color} animatedProps={propsA} />
      <AnimatedCircle cx="21" cy="17" r="0.8" fill={color} animatedProps={propsB} />
    </Svg>
  );
}
