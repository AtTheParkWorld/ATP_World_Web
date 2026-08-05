/** Share (Lucide "share-2") — three nodes + connectors. */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconShare({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="18" cy="5" r="3" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="6" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} />
      <Circle cx="18" cy="19" r="3" stroke={color} strokeWidth={strokeWidth} />
      <Path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
