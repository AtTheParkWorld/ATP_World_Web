/**
 * Tab-bar Community icon — heart shape with two small figure dots
 * inside (heads + bodies suggested by a triangle/diamond) and a
 * tiny checkmark badge above. Matches the contact sheet Community
 * mark ("We move together"). Static, clear, readable at 26pt.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabCommunity({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Heart */}
      <Path
        d="M12 21s-7-4.5-7-10.5a5 5 0 0 1 7-4.6A5 5 0 0 1 19 10.5C19 16.5 12 21 12 21Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Two figures inside the heart — heads */}
      <Circle cx="10" cy="11.5" r="1.1" fill={color} />
      <Circle cx="14" cy="11.5" r="1.1" fill={color} />
      {/* Two figures inside the heart — arms-up bodies (small V's) */}
      <Path d="M8.7 16 L10 13.5 L11.3 16" stroke={color} strokeWidth={strokeWidth - 0.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12.7 16 L14 13.5 L15.3 16" stroke={color} strokeWidth={strokeWidth - 0.6} strokeLinecap="round" strokeLinejoin="round" />
      {/* Checkmark badge above */}
      <Path d="M10.5 3.5 L11.5 4.5 L13.5 2.5" stroke={color} strokeWidth={strokeWidth - 0.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
