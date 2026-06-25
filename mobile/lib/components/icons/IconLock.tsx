/** Padlock — Premium / tier-gated content. */
import Svg, { Path, Rect } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconLock({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="11" width="16" height="10" rx="2" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M12 15v3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
