/** Gift box — Rewards. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconGift({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 10h16v10H4V10ZM3 7h18v3H3V7Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M12 7v13M12 7c-1.5-3-5-3-5-1s2 1 5 1ZM12 7c1.5-3 5-3 5-1s-2 1-5 1Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  );
}
