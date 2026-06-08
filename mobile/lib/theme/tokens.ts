/**
 * ATP design tokens — single source of truth for non-NativeWind contexts
 * (e.g., values passed into Stripe PaymentSheet, Sentry boundaries,
 * dynamically-styled SVGs). NativeWind classes in JSX use the
 * tailwind.config.js mirror of these same values.
 *
 * Match the web's atp.css custom properties so design changes propagate.
 */

export const colors = {
  // Brand
  green:      '#7AC231',
  greenDark:  '#5a9a1f',
  greenLight: '#a8e055',

  // Surface (dark-first per UX direction)
  black:      '#0a0a0a',
  dark:       '#111111',
  dark2:      '#1a1a1a',
  dark3:      '#222222',

  // Text
  white:      '#ffffff',
  light:      '#aaaaaa',
  muted:      '#888888',

  // Semantic
  success:    '#7AC231',
  danger:     '#ef4444',
  warning:    '#f59e0b',
  info:       '#60a5fa',
} as const;

export const tribePalette = {
  better:   '#4ade80',
  faster:   '#60a5fa',
  stronger: '#f97316',
} as const;

export type TribeSlug = keyof typeof tribePalette;

export const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
} as const;

export const fontSizes = {
  xs:  11,
  sm:  13,
  base: 15,
  lg:  18,
  xl:  22,
  '2xl': 28,
  '3xl': 34,
  '4xl': 44,
} as const;

export const fontFamily = {
  // Bundled via expo-font in app/_layout.tsx
  display:      'BarlowCondensed_800ExtraBold',
  displayBlack: 'BarlowCondensed_900Black',
  body:         'DMSans_400Regular',
  bodyBold:     'DMSans_700Bold',
} as const;

/** Tribe slug → palette colour. Mirrors web's normalizeTribe. */
export function tribeColor(slug?: string | null): string {
  const k = String(slug || '').toLowerCase() as TribeSlug;
  return tribePalette[k] || colors.green;
}
