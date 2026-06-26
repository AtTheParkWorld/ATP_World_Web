/**
 * Tab-bar Rewards icon — cut diamond / gem flanked by two sparkle
 * accents (matches the contact sheet Rewards mark "Earn. Unlock.").
 * Static SVG with clean facet lines.
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabRewards({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gem outline */}
      <Path
        d="M7 6h10l3 4-8 10.5L4 10l3-4Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Facet lines */}
      <Path
        d="M4 10h16M10 6l2 4 2-4M12 10l-2 4M12 10l2 4"
        stroke={color}
        strokeWidth={Math.max(strokeWidth - 0.6, 1.5)}
        strokeLinejoin="round"
      />
      {/* Sparkle accents (static — two small plus marks) */}
      <Path d="M2.5 5v1.6M1.7 5.8h1.6" stroke={color} strokeWidth={strokeWidth - 0.6} strokeLinecap="round" />
      <Path d="M21.5 16v1.6M20.7 16.8h1.6" stroke={color} strokeWidth={strokeWidth - 0.6} strokeLinecap="round" />
    </Svg>
  );
}
