/** Barbell — Coach / fitness contexts. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconDumbbell({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 9v6M5.5 7v10M21 9v6M18.5 7v10M5.5 12h13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
