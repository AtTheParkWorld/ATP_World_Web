/**
 * Tab-bar Rewards — Lucide "gem" (lucide.dev, ISC license).
 * Professionally-designed outline geometry ported verbatim:
 * 24×24 viewBox, stroke-based, round caps/joins.
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabRewards({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  // Lucide is drawn for stroke-width 2 at 24px; DEFAULTS.strokeWidth (2.5) * 0.8 = 2.
  const sw = strokeWidth * 0.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 3h12l4 6-10 13L2 9Z" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M11 3 8 9l4 13 4-13-3-6" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2 9h20" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
