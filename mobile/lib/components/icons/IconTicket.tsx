/** Ticket — Ambassador dashboard. Sharp angular cut keeps the brand vibe. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTicket({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M14 8v8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray="2 2" />
    </Svg>
  );
}
