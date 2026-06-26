/**
 * Tab-bar Profile icon — classic person mark: head circle on top,
 * shoulders curve underneath (drawn with a quadratic Bezier so the
 * arc geometry is exact, not relying on SVG's elliptic-arc ambiguity).
 * Static. Active state is the outer focus spring + green tint.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabProfile({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Head */}
      <Circle
        cx="12" cy="8.5"
        r="3.6"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {/* Shoulders — quadratic curve, control point above the chord */}
      <Path
        d="M4.5 20.5 Q 12 13 19.5 20.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
