/**
 * Tab-bar Home — contact-sheet mark ("Your park. Your space."):
 * house with rounded corners, a person (head + shoulders) inside,
 * and a small sun dot floating at the roof's right slope.
 * Geometry visually verified against the ChatGPT design sheet.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabHome({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  const sw = strokeWidth * 0.8;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* House */}
      <Path
        d="M4.3 10.9 12 4.3l7.7 6.6v8.2a1.2 1.2 0 0 1-1.2 1.2H5.5a1.2 1.2 0 0 1-1.2-1.2Z"
        stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      />
      {/* Person inside */}
      <Circle cx="12" cy="13.2" r="1.9" stroke={color} strokeWidth={sw} />
      <Path d="M8.7 20.3a3.3 3.3 0 0 1 6.6 0" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* Sun dot at the roof's right slope */}
      <Circle cx="19.6" cy="4.9" r="1.35" stroke={color} strokeWidth={sw} />
    </Svg>
  );
}
