/**
 * Tab-bar Profile — contact-sheet aura mark ("Your journey. Your
 * identity."): three concentric rings opening at the bottom, with a
 * person (head + shoulders) sitting in the opening.
 * Geometry visually verified against the ChatGPT design sheet.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabProfile({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  const sw = strokeWidth * 0.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Aura rings — open at the bottom where the person sits */}
      <Path d="M8.9 14.6a4 4 0 1 1 6.2 0"    stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Path d="M6.9 16.2a6.6 6.6 0 1 1 10.2 0" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Path d="M5 17.9a9.2 9.2 0 1 1 14 0"    stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* Person */}
      <Circle cx="12" cy="16" r="1.8" stroke={color} strokeWidth={sw} />
      <Path d="M8.8 21.4a3.2 3.2 0 0 1 6.4 0" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}
