/**
 * Tab-bar Store icon — shopping cart with two wheels + a sparkle
 * accent (matches the ChatGPT contact-sheet store design). When
 * active, the sparkle twinkles and the cart bumps forward subtly
 * like it's being pushed.  Unambiguous commerce metaphor at 26pt.
 */
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withSequence, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function IconTabStore({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth, active = false }: IconProps) {
  const x = useSharedValue(0);
  const spark = useSharedValue(0.3);

  useEffect(() => {
    if (!active) { cancelAnimation(x); cancelAnimation(spark); x.value = 0; spark.value = 1; return; }
    const slide = { duration: 380, easing: Easing.inOut(Easing.cubic) };
    x.value = withRepeat(withSequence(withTiming(0.8, slide), withTiming(0, slide), withTiming(0, { duration: 400 })), -1);
    const blink = { duration: 500, easing: Easing.inOut(Easing.cubic) };
    spark.value = withRepeat(withSequence(withTiming(1, blink), withTiming(0.3, blink)), -1);
    return () => { cancelAnimation(x); cancelAnimation(spark); };
  }, [active, x, spark]);

  const cartProps  = useAnimatedProps(() => ({ transform: [{ translateX: x.value }] as any }));
  const sparkProps = useAnimatedProps(() => ({ opacity: spark.value } as any));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <AnimatedG animatedProps={cartProps}>
        {/* Cart hook + top rim */}
        <Path
          d="M2.5 4h2l1 2M6 7l1.4 8.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6.4"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Wheels */}
        <Circle cx="9.5"  cy="20" r="1.4" stroke={color} strokeWidth={strokeWidth} />
        <Circle cx="16.5" cy="20" r="1.4" stroke={color} strokeWidth={strokeWidth} />
      </AnimatedG>
      {/* Sparkle accent — premium "something new" feel */}
      <AnimatedPath
        d="M21 4 L21 6.4 M19.8 5.2 L22.2 5.2"
        stroke={color}
        strokeWidth={strokeWidth - 0.4}
        strokeLinecap="round"
        animatedProps={sparkProps}
      />
    </Svg>
  );
}
