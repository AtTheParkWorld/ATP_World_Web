/**
 * Tab-bar Community icon — clean heart. When active, beats lub-dub at
 * ~70 bpm (same rhythm as the in-app IconHeart so supporter + community
 * share visual cadence). Dropped the inner figure-dots — they read as
 * speckles at 26pt. The beat alone communicates "alive, together".
 *
 * Two soft sparkle dots flank the heart on the outside, twinkling in
 * alternation. They sell "love radiating outward" without crowding
 * the silhouette.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function IconTabCommunity({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const s   = useSharedValue(1);
  const sA  = useSharedValue(1);
  const sB  = useSharedValue(0.3);

  useEffect(() => {
    if (!active) {
      cancelAnimation(s); cancelAnimation(sA); cancelAnimation(sB);
      s.value = 1; sA.value = 1; sB.value = 1;
      return;
    }
    const fast = { duration: 110, easing: Easing.out(Easing.cubic) };
    const slow = { duration: 180, easing: Easing.inOut(Easing.cubic) };
    s.value = withRepeat(
      withSequence(
        withTiming(1.18, fast),
        withTiming(1.0,  slow),
        withTiming(1.10, fast),
        withTiming(1.0,  slow),
        withTiming(1.0,  { duration: 280 }),
      ),
      -1
    );
    const sCfg = { duration: 650, easing: Easing.inOut(Easing.cubic) };
    sA.value = withRepeat(withSequence(withTiming(0.3, sCfg), withTiming(1, sCfg)), -1);
    sB.value = withRepeat(withSequence(withTiming(1, sCfg),   withTiming(0.3, sCfg)), -1);
    return () => { cancelAnimation(s); cancelAnimation(sA); cancelAnimation(sB); };
  }, [active, s, sA, sB]);

  const heartProps = useAnimatedProps(() => ({
    transform: [{ translateX: 12 }, { translateY: 13 }, { scale: s.value }, { translateX: -12 }, { translateY: -13 }] as any,
  }));
  const dotAProps = useAnimatedProps(() => ({ opacity: sA.value } as any));
  const dotBProps = useAnimatedProps(() => ({ opacity: sB.value } as any));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={heartProps}>
        <Path
          d="M12 20.5s-7-4.5-7-10.5a5 5 0 0 1 7-4.6A5 5 0 0 1 19 10c0 6-7 10.5-7 10.5Z"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      </AnimatedG>
      {/* Twinkle accents — "love radiating" */}
      <AnimatedCircle cx="3"  cy="7"  r="0.9" fill={color} animatedProps={dotAProps} />
      <AnimatedCircle cx="21" cy="8" r="0.9" fill={color} animatedProps={dotBProps} />
    </Svg>
  );
}
