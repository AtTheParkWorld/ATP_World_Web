/**
 * Bottom padding for the sticky action bars (Reserve / Book / Redeem).
 *
 * Founder 2026-10-07: on a Samsung with the three-button navigation bar,
 * "Reserve free spot" sat half under the phone's own buttons. These
 * screens draw edge-to-edge and the bar used a fixed 28px bottom pad, so
 * any navigation bar taller than that covered the button. The pad now
 * clears the system inset with room to spare, and never drops below the
 * old 28px on phones with gesture navigation.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MIN_PAD = 28;
const ABOVE_NAV_BAR = 16;

export function useStickyFooterPad(): number {
  const insets = useSafeAreaInsets();
  return Math.max(MIN_PAD, insets.bottom + ABOVE_NAV_BAR);
}

