/**
 * Tab-bar Profile icon — concentric arcs radiating from a centre dot,
 * matching the "Your journey. Your identity." mark on the contact
 * sheet's NAVIGATION row. Reads as a member badge / signal of
 * presence rather than a generic silhouette.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabProfile({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="13" r="2" fill={color} />
      {/* Three concentric arcs opening upward */}
      <Path d="M9 13a3 3 0 0 1 6 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M6 13a6 6 0 0 1 12 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M3 13a9 9 0 0 1 18 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
