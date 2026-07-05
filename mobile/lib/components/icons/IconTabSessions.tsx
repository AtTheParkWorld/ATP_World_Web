/**
 * Tab-bar Sessions — contact-sheet kettlebell ("Train. Elevate."):
 * big ring handle whose open ends land on a squat rounded-square
 * body, flanked by two short side ticks at mid-body height.
 * Geometry visually verified against the ChatGPT design sheet.
 */
import Svg, { Path, Rect } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabSessions({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  const sw = strokeWidth * 0.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Handle: prominent ring, open ends on the body top */}
      <Path d="M8.6 10.6a4.3 4.3 0 1 1 6.8 0" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* Bell body */}
      <Rect x="5.4" y="10.6" width="13.2" height="8.8" rx="4.4" stroke={color} strokeWidth={sw} />
      {/* Side ticks */}
      <Path d="M3 13.9v2.4M21 13.9v2.4" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}
