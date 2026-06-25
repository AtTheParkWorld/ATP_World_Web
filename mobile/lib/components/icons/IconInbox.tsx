/** Envelope — Coach inquiries / Messages. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconInbox({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18v12H3V6Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="m3 6 9 7 9-7" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </Svg>
  );
}
