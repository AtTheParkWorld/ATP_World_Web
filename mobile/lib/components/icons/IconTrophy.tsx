/** Trophy — Leaderboard / Achievements. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTrophy({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 18h6M10 14v4M14 14v4M9 21h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
