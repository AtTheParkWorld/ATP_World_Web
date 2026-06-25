/** Shopping bag — Store / Shop. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconBag({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 8h14l-1 13H6L5 8Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M9 11V7a3 3 0 0 1 6 0v4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
