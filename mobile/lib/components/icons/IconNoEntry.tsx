/** Prohibited / no-entry — Blocked members. */
import Svg, { Circle, Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconNoEntry({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
      <Path d="m5.6 5.6 12.8 12.8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
