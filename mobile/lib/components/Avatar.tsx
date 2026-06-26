/**
 * Avatar — the single source of truth for member portraits.
 *
 * If `uri` is provided, renders the uploaded image. Otherwise falls
 * back to the member's initials laid over a deterministic two-tone
 * gradient circle. The hue is derived from the name (or id), so the
 * same member always gets the same colour — recognisable across
 * screens without exposing any backend lookup.
 *
 * Sizes are presets to keep type/border weights coherent across
 * Home, Profile, Friends, Comments, DMs, Leaderboard. Pass a number
 * for an arbitrary size only when none of the presets fit.
 */
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

type SizePreset = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const PRESET_PX: Record<SizePreset, number> = {
  xs: 24,
  sm: 32,
  md: 48,
  lg: 72,
  xl: 112,
};

interface AvatarProps {
  uri?:        string | null;
  name?:       string | null;
  firstName?:  string | null;
  lastName?:   string | null;
  id?:         string | number | null;
  size?:       SizePreset | number;
  borderColor?: string;
  borderWidth?: number;
}

// Hash a string to one of 12 brand-adjacent hues. Greens/teals weighted
// because the brand is electric lime; we mix in some warmer accents
// (lilac, peach) so the deck of avatars on Community / Leaderboard
// doesn't feel monochrome.
const PALETTE: [string, string][] = [
  ['#A8FF00', '#4ade80'], // electric lime → emerald
  ['#4ade80', '#22c55e'], // emerald
  ['#34d399', '#0d9488'], // teal
  ['#60a5fa', '#2563eb'], // blue
  ['#a78bfa', '#7c3aed'], // violet
  ['#f472b6', '#db2777'], // pink
  ['#fb7185', '#e11d48'], // rose
  ['#fbbf24', '#d97706'], // amber
  ['#fb923c', '#ea580c'], // orange
  ['#22d3ee', '#0891b2'], // cyan
  ['#86efac', '#16a34a'], // mint
  ['#facc15', '#a16207'], // gold
];

function pickGradient(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function initialsFor(firstName?: string | null, lastName?: string | null, name?: string | null): string {
  const first = (firstName || '').trim();
  const last  = (lastName  || '').trim();
  if (first || last) {
    return ((first[0] || '') + (last[0] || '')).toUpperCase() || '?';
  }
  const whole = (name || '').trim();
  if (!whole) return '?';
  const parts = whole.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || whole[0]?.toUpperCase() || '?';
}

export function Avatar({
  uri,
  name,
  firstName,
  lastName,
  id,
  size = 'md',
  borderColor,
  borderWidth = 0,
}: AvatarProps) {
  const px = typeof size === 'number' ? size : PRESET_PX[size];
  const resolved = absUrl(uri ?? undefined);

  const wrapStyle = {
    width: px,
    height: px,
    borderRadius: px / 2,
    overflow: 'hidden' as const,
    ...(borderWidth > 0
      ? { borderWidth, borderColor: borderColor || colors.green }
      : {}),
  };

  if (resolved) {
    // expo-image handles cross-origin redirects (our /api/cms/media/:id
    // 302s to a Cloudflare R2 URL) and caches transparently — RN's
    // built-in Image sometimes drops the redirected response.
    return (
      <View style={wrapStyle}>
        <Image
          source={{ uri: resolved }}
          style={{ width: px, height: px }}
          contentFit="cover"
          transition={120}
        />
      </View>
    );
  }

  // Fallback: gradient + initials. The seed prefers id (stable across
  // name changes) but falls back to first+last so brand-new members
  // still get something distinctive before they pick a handle.
  const seed = String(id ?? (`${firstName || ''}-${lastName || ''}-${name || ''}` || '?'));
  // SVG defs IDs must be alphanumeric-safe — strip everything else so the
  // url(#…) reference always resolves on iOS + Android.
  const gradId = `avg-${seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) || 'x'}-${px}`;
  const [c1, c2] = pickGradient(seed);
  const initials = initialsFor(firstName, lastName, name);

  // Font sizing — keep initials visually centred and bold across presets
  const fontPx = Math.round(px * 0.42);

  return (
    <View style={wrapStyle}>
      <Svg width={px} height={px} viewBox="0 0 100 100" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c1} stopOpacity="1" />
            <Stop offset="1" stopColor={c2} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={`url(#${gradId})`} />
      </Svg>
      <View style={{ width: px, height: px, alignItems: 'center', justifyContent: 'center' }}>
        <Text
          style={{
            fontFamily: fontFamily.displayBlack,
            fontSize:   fontPx,
            color:      '#0a0a0a',
            letterSpacing: -0.5,
          }}
        >
          {initials}
        </Text>
      </View>
    </View>
  );
}
