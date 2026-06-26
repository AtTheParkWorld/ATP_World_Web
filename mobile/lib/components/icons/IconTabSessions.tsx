/**
 * Tab-bar Sessions icon — kettlebell, static. Rounded-rect handle on
 * top, short neck, round bell, plus a small highlight dot for premium
 * detail. No motion — the AnimatedG transform-array trick mis-renders
 * in react-native-svg at small sizes, so we keep the silhouette clean
 * and let the outer focus spring (1.0 → 1.15) carry the active state.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabSessions({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Handle — rounded rectangle */}
      <Path
        d="M9 3.5h6a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Neck */}
      <Path d="M9.5 9v1M14.5 9v1" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      {/* Bell — round, dominant */}
      <Circle cx="12" cy="15.5" r="5" stroke={color} strokeWidth={strokeWidth} />
      {/* Highlight dot — small touch of premium */}
      <Circle cx="10" cy="14" r="0.7" fill={color} />
    </Svg>
  );
}
