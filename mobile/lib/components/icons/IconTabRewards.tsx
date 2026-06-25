/**
 * Tab-bar Rewards icon — diamond / cut gem with sparkle accents
 * around it. Matches the contact sheet's NAVIGATION row design
 * ("Earn. Unlock."). Reads as premium value, more aspirational than
 * a gift box.
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabRewards({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gem body */}
      <Path d="M6 4h12l3 5-9 11L3 9l3-5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      {/* Facet lines */}
      <Path d="M3 9h18M9 4l3 6 3-6M12 10v0M9 4 6 9M15 4l3 5" stroke={color} strokeWidth={strokeWidth - 0.5} strokeLinejoin="round" />
    </Svg>
  );
}
