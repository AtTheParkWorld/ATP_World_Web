/**
 * Tab-bar Profile icon — concentric arcs (Wi-Fi-style, but vertical
 * orientation) opening UPWARD over a small head circle. Matches the
 * contact sheet Profile mark ("Your journey. Your identity.") which
 * combines the radiating signal with a person silhouette.
 */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconTabProfile({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Centre dot — the "you" */}
      <Circle cx="12" cy="17" r="1.6" fill={color} />
      {/* Three concentric arcs, opening upward (signal/aura) */}
      <Path d="M9 17a3 3 0 0 1 6 0"   stroke={color} strokeWidth={strokeWidth - 0.2} strokeLinecap="round" />
      <Path d="M6 17a6 6 0 0 1 12 0"  stroke={color} strokeWidth={strokeWidth - 0.2} strokeLinecap="round" />
      <Path d="M3 17a9 9 0 0 1 18 0"  stroke={color} strokeWidth={strokeWidth - 0.2} strokeLinecap="round" />
    </Svg>
  );
}
