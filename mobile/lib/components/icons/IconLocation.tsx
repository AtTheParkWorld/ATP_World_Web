/** Location pin — Sessions list / Cities filter / Coach city label. */
import Svg, { Path, Circle } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconLocation({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Circle cx="12" cy="9" r="2.5" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
