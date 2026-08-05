/** Target (Lucide "target") — Challenges. */
import Svg, { Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTarget({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="12" cy="12" r="6" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="12" cy="12" r="2" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
