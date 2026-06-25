/**
 * Tab-bar Community icon — heart with a small checkmark inside,
 * symbolising "we move together" + accepted membership in the tribe.
 * Matches the contact sheet's NAVIGATION row design (heart + figures).
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabCommunity({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20.5s-7-4.5-7-10.5a5 5 0 0 1 7-4.6A5 5 0 0 1 19 10c0 6-7 10.5-7 10.5Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Inner checkmark — "two together, confirmed" */}
      <Path d="m9 11 2.5 2.5L15 9.5" stroke={color} strokeWidth={strokeWidth - 0.3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
