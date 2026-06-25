/** Info circle — About. */
import Svg, { Circle, Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconInfo({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M12 11v6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx="12" cy="8" r="0.8" fill={color} />
    </Svg>
  );
}
