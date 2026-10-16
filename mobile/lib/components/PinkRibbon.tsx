/**
 * Pink October (founder 2026-10-16): the breast-cancer-awareness ribbon on
 * every session card while it is October in Dubai. It switches itself off on
 * 1 November — nothing to remove by hand. Same ribbon as the website
 * (backend/public/pink-october.js), background removed.
 */
import { Image } from 'react-native';

const RIBBON = require('@/assets/images/pink-ribbon.png');
const ASPECT = 75 / 128;   // asset is 75 × 128

/** True while it is October in Dubai (UTC+4, no DST). */
export function isPinkOctober(now: number = Date.now()): boolean {
  return new Date(now + 4 * 3600 * 1000).getUTCMonth() === 9;
}

/** Inline ribbon for a card's label row; renders nothing outside October. */
export function PinkRibbon({ height = 16 }: { height?: number }) {
  if (!isPinkOctober()) return null;
  return (
    <Image
      source={RIBBON}
      style={{ width: Math.round(height * ASPECT), height }}
      resizeMode="contain"
      accessibilityLabel="Breast Cancer Awareness Month"
    />
  );
}
