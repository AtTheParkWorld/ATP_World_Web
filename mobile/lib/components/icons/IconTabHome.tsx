/**
 * Tab-bar Home — Lucide "house" (lucide.dev, ISC license).
 * Professionally-designed outline geometry ported verbatim:
 * 24×24 viewBox, stroke-based, round caps/joins.
 * Renders in whatever `color` the tab bar passes (lime when focused).
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabHome({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  // Lucide is drawn for stroke-width 2 at 24px; DEFAULTS.strokeWidth (2.5) * 0.8 = 2.
  // The tab bar's focused/unfocused strokeWidth still modulates weight through this.
  const sw = strokeWidth * 0.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
