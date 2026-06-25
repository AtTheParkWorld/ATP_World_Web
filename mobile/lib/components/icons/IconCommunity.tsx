/** Two-person community mark — Community tab. Reads as "your tribe"
 *  rather than a single profile (avoids confusion with the Profile tab icon). */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconCommunity({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="8.5"  cy="9" r="3" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="16"   cy="10" r="2.5" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M2.5 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M16 14c2.8 0 5 2.2 5 5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
