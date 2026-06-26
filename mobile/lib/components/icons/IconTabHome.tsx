/**
 * Tab-bar Home icon — house outline with a small person silhouette
 * peeking from the door and a sparkle accent above the roof.
 * Matches the contact sheet Home mark ("Your park. Your space.").
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabHome({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* House */}
      <Path
        d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* Person inside (head + shoulders) */}
      <Circle cx="12" cy="14" r="1.6" stroke={color} strokeWidth={strokeWidth - 0.4} />
      <Path d="M9.5 20a2.5 2.5 0 0 1 5 0" stroke={color} strokeWidth={strokeWidth - 0.4} strokeLinecap="round" />
      {/* Sparkle above-right */}
      <Path d="M19.5 4v1.8M18.6 4.9h1.8" stroke={color} strokeWidth={strokeWidth - 0.4} strokeLinecap="round" />
    </Svg>
  );
}
