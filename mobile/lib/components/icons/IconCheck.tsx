/** Checkmark — completion / attendance / friend accepted. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconCheck({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12.5 9.5 18 20 6.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
