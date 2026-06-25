/** Camera — attach photo to community post. */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconCamera({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 8h3l2-3h8l2 3h3v12H3V8Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Circle cx="12" cy="13" r="4" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
