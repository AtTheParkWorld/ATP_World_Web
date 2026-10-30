/**
 * Pink October (founder 2026-10-16): the breast-cancer-awareness ribbon on
 * session cards while it is October in Dubai. It switches itself off on
 * 1 November — nothing to remove by hand. Only sessions DATED in October
 * carry it (founder 2026-10-30: none on sessions from 1 November). Same
 * ribbon as the website (backend/public/pink-october.js), background removed.
 */
import { Image } from 'react-native';

const RIBBON = require('@/assets/images/pink-ribbon.png');
const ASPECT = 75 / 128;   // asset is 75 × 128

const DUBAI = 4 * 3600 * 1000;   // UTC+4, no DST

/** True while it is October in Dubai and the session (`at`) is dated in
 *  this October too. */
export function isPinkOctober(at?: string | null, now: number = Date.now()): boolean {
  const n = new Date(now + DUBAI);
  if (n.getUTCMonth() !== 9 || !at) return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  const d = new Date(t + DUBAI);
  return d.getUTCMonth() === 9 && d.getUTCFullYear() === n.getUTCFullYear();
}

/** Inline ribbon for a session's label row; renders nothing unless the
 *  session (`at` = scheduled_at) is in October. */
export function PinkRibbon({ height = 16, at }: { height?: number; at?: string | null }) {
  if (!isPinkOctober(at)) return null;
  return (
    <Image
      source={RIBBON}
      style={{ width: Math.round(height * ASPECT), height }}
      resizeMode="contain"
      accessibilityLabel="Breast Cancer Awareness Month"
    />
  );
}
