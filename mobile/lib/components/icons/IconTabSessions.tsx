/**
 * Tab-bar Sessions — Lucide "calendar-days" (lucide.dev, ISC license).
 * Professionally-designed outline geometry ported verbatim:
 * 24×24 viewBox, stroke-based, round caps/joins. The `h.01` micro-paths
 * render as day dots thanks to the round line caps.
 */
import Svg, { Path, Rect } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabSessions({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  // Lucide is drawn for stroke-width 2 at 24px; DEFAULTS.strokeWidth (2.5) * 0.8 = 2.
  const sw = strokeWidth * 0.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 2v4" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 2v4" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="3" y="4" width="18" height="18" rx="2" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 10h18" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 14h.01" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 14h.01" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 14h.01" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 18h.01" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 18h.01" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M16 18h.01" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
