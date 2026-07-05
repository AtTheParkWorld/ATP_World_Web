/**
 * Tab-bar Rewards — contact-sheet gem ("Earn. Unlock."):
 * faceted diamond with a plus-sparkle top-left and a tiny sparkle
 * dot bottom-right.
 * Geometry visually verified against the ChatGPT design sheet.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabRewards({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  const sw = strokeWidth * 0.8;
  const swDetail = strokeWidth * 0.7;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Gem outline */}
      <Path d="M8 6.2h8l3 3.9L12 19.8 5 10.1Z" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      {/* Facet lines */}
      <Path d="M5 10.1h14M10.3 6.2l1.7 3.9 1.7-3.9M8.3 10.1 12 19.8l3.7-9.7" stroke={color} strokeWidth={swDetail} strokeLinejoin="round" />
      {/* Plus-sparkle top-left */}
      <Path d="M4.6 2.2v3.2M3 3.8h3.2" stroke={color} strokeWidth={swDetail} strokeLinecap="round" />
      {/* Sparkle dot bottom-right */}
      <Circle cx="20.6" cy="16.6" r="0.6" fill={color} />
    </Svg>
  );
}
