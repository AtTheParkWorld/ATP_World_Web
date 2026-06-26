/**
 * Tab-bar Community icon — clean heart with two outer twinkle dots.
 * Static. The outer dots read as "love radiating", the heart shape
 * carries the meaning. Active state is the outer focus spring + green
 * tint — no inner motion required.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabCommunity({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20.5s-7-4.5-7-10.5a5 5 0 0 1 7-4.6A5 5 0 0 1 19 10c0 6-7 10.5-7 10.5Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Circle cx="3"  cy="7" r="0.9" fill={color} />
      <Circle cx="21" cy="8" r="0.9" fill={color} />
    </Svg>
  );
}
