/** Clipboard — Coach offerings list. */
import Svg, { Path, Rect } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconClipboard({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="5" width="14" height="16" rx="2" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M9 5V3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3.5V5H9Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M9 11h6M9 14h6M9 17h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
