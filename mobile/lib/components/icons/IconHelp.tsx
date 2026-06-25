/** Question mark in a circle — Help & support. */
import Svg, { Circle, Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconHelp({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4V14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx="12" cy="17" r="0.7" fill={color} />
    </Svg>
  );
}
