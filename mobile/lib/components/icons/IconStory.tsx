/** Open book — Stories / Blog. */
import Svg, { Path } from 'react-native-svg';
import { DEFAULTS, type IconProps } from './types';

export function IconStory({ size = DEFAULTS.size, color = DEFAULTS.color, strokeWidth = DEFAULTS.strokeWidth }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 5h7a2 2 0 0 1 2 2v12H5a2 2 0 0 1-2-2V5ZM21 5h-7a2 2 0 0 0-2 2v12h7a2 2 0 0 0 2-2V5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M12 7v12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
