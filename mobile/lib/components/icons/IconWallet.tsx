/** Wallet — Coach earnings / member balance. */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconWallet({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 7h15a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M3 7V6a2 2 0 0 1 2-2h11" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx="17" cy="14" r="1.5" fill={color} />
    </Svg>
  );
}
