/**
 * Tab-bar Community — contact-sheet mark ("We move together."):
 * two figures with raised arms whose inner arms flow into a shared
 * heart with a checkmark inside.
 * Geometry visually verified against the ChatGPT design sheet.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabCommunity({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  const sw = strokeWidth * 0.8;
  const swDetail = strokeWidth * 0.7;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Heads */}
      <Circle cx="7"  cy="5.2" r="2" stroke={color} strokeWidth={sw} />
      <Circle cx="17" cy="5.2" r="2" stroke={color} strokeWidth={sw} />
      {/* Outer arms: raised up-out */}
      <Path d="M3.6 10.4 5 6.6M20.4 10.4 19 6.6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* Inner arms: flow down into the heart's top lobes */}
      <Path d="M9 6.8c.6 1.6.4 2.8-.3 4M15 6.8c-.6 1.6-.4 2.8.3 4" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* Heart between the figures */}
      <Path
        d="M12 20.4c-3.4-2.3-5.6-4.4-5.6-6.9a2.8 2.8 0 0 1 5.6-1.1 2.8 2.8 0 0 1 5.6 1.1c0 2.5-2.2 4.6-5.6 6.9Z"
        stroke={color} strokeWidth={sw} strokeLinejoin="round"
      />
      {/* Check inside the heart */}
      <Path d="m10.2 14.4 1.4 1.4 2.4-2.6" stroke={color} strokeWidth={swDetail} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
