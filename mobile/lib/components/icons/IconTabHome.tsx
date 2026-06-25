/**
 * Tab-bar Home icon — angular house outline with two small "stars"
 * above (the playful detail from the ChatGPT contact sheet's
 * NAVIGATION row). Distinct from the generic IconHome we use in
 * link rows so the tab bar feels intentional.
 */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabHome({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 12 12 4l9 8v9h-6v-6h-6v6H3v-9Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="m18 5-.5-1.5L17 5l-1.5.5L17 6l.5 1.5L18 6l1.5-.5L18 5ZM6 6 5.5 4.5 5 6l-1.5.5L5 7l.5 1.5L6 7l1.5-.5L6 6Z" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  );
}
