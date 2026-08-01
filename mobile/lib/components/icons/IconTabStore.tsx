/**
 * Tab-bar Store — Lucide "shopping-bag" (lucide.dev, ISC license).
 * Professionally-designed outline geometry ported verbatim:
 * 24×24 viewBox, stroke-based, round caps/joins.
 * Static mark — the tab bar's spring scale + dot supply the focus motion.
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabStore({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  // Lucide is drawn for stroke-width 2 at 24px; DEFAULTS.strokeWidth (2.5) * 0.8 = 2.
  const sw = strokeWidth * 0.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 6h18" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 10a4 4 0 0 1-8 0" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
