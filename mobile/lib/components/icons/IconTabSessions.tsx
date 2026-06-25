/**
 * Tab-bar Sessions icon — kettlebell, the fitness-brand-specific
 * mark from the contact sheet (not a generic calendar). Reads
 * instantly as "training" rather than "schedule".
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabSessions({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Handle */}
      <Path d="M9 5h6M9 5a3 3 0 0 0-3 3M15 5a3 3 0 0 1 3 3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      {/* Top yoke */}
      <Path d="M6 8h12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      {/* Bell body */}
      <Path d="M6.5 8 5 12a7 7 0 0 0 14 0l-1.5-4" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  );
}
