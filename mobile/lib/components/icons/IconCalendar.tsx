/** Calendar — Sessions tab. Dot marks "today" so the icon reads as
 *  a live schedule rather than a static calendar. */
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconCalendar({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="5" width="18" height="16" rx="2" stroke={color} strokeWidth={strokeWidth} />
      <Path d="M8 3v4M16 3v4M3 10h18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx="12" cy="15" r="1.6" fill={color} />
    </Svg>
  );
}
