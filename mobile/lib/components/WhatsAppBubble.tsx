/**
 * Floating WhatsApp bubble — one tap opens a chat with the ATP admin
 * (founder 2026-10-06: "a floating bubble across all pages on the app and
 * website allowing members to WhatsApp directly our admin").
 *
 * Rendered ONCE by the root layout, above the navigator, so every screen
 * gets it without touching each route. Placement rules:
 *   - bottom-LEFT: the Community "+" composer owns bottom-right;
 *   - on the tabs it floats just above the tab bar, elsewhere just above
 *     the system navigation bar;
 *   - hidden where the bottom of the screen is busy — chat / comment /
 *     compose inputs, sticky "Book" / checkout CTAs, the in-app shop,
 *     live video, camera, forms — and whenever the keyboard is up;
 *   - hidden until signed in (auth + onboarding screens).
 */
import { useEffect, useState } from 'react';
import { Keyboard, Linking, Platform, Pressable } from 'react-native';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, tabBarHeight, tabBarPadBottom } from '@/lib/theme/tokens';
import { atpWhatsAppUrl } from '@/lib/utils/whatsapp';

const SIZE = 48;
const GAP = 14;

// Route prefixes (expo-router segments joined with "/") where the bubble
// would sit on top of something the member needs.
const HIDDEN_ON = [
  '(auth)', 'auth', 'onboarding',                          // not signed in yet / setting up
  'messages', 'community/compose', 'community/post',       // typing at the bottom
  'coach/threads/[id]',
  'coaches', 'sessions/[id]', 'rewards/offer', 'rewards/redeem',  // sticky Book / redeem CTA
  'supporter', '(tabs)/store',                             // checkout, Shopify's own sticky bars
  'profile/edit', 'coach/profile', 'coach/offerings',      // forms
  'live', 'story', 'ambassador/scan',                      // full-screen video / camera
];

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}

export function WhatsAppBubble() {
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const signedIn = useAuthStore((s) => !!s.accessToken);
  const keyboardUp = useKeyboardVisible();

  const path = segments.join('/');
  if (!signedIn || keyboardUp || segments.length === 0) return null;
  if (HIDDEN_ON.some((p) => path === p || path.startsWith(p + '/'))) return null;

  const onTabs = segments[0] === '(tabs)';
  const bottom = (onTabs ? tabBarHeight(insets.bottom) : tabBarPadBottom(insets.bottom)) + GAP;

  return (
    <Pressable
      onPress={() => { Linking.openURL(atpWhatsAppUrl()).catch(() => {}); }}
      accessibilityRole="button"
      accessibilityLabel="Message ATP on WhatsApp"
      hitSlop={6}
      style={({ pressed }) => ({
        position: 'absolute',
        left: 16,
        bottom,
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        backgroundColor: colors.green,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.94 : 1 }],
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      })}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path
          fill={colors.black}
          d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"
        />
      </Svg>
    </Pressable>
  );
}
