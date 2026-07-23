/**
 * Universal-link landing page. Opens when the user taps a magic-link
 * email on their device. Expo Router parses ?token + ?email from the
 * deep link, we hand them to /auth/verify, then bounce into the app.
 *
 * Universal-link wiring:
 *   iOS:     applinks:atthepark.world (AASA path /auth/verify)
 *   Android: assetlinks.json + intentFilters in app.json
 * app/auth/verify.tsx re-exports this screen so the emailed URL
 * (/auth/verify?token&email) resolves to a real expo-router route.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { verifyMagicLink, AccountSuspendedError } from '@/lib/api/auth';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function MagicLinkCallback() {
  const params = useLocalSearchParams<{ token?: string; email?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = (params.token || '').toString();
    const email = (params.email || '').toString();
    if (!token || !email) {
      setError('That link is missing required parameters. Request a new one.');
      return;
    }
    (async () => {
      try {
        await verifyMagicLink(token, email);
        router.replace('/(tabs)/home');
      } catch (err) {
        if (err instanceof AccountSuspendedError) {
          router.replace('/(auth)/suspended');
          return;
        }
        setError((err as Error).message || 'That link is invalid or expired.');
      }
    })();
  }, [params.token, params.email]);

  if (error) {
    return (
      <View className="flex-1 bg-atp-black px-6 pt-24 pb-12 justify-between">
        <View>
          <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-red text-4xl uppercase tracking-tight">
            Link{'\n'}didn't work.
          </Text>
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-base mt-4 leading-relaxed">
            {error}
          </Text>
        </View>
        <View className="gap-2">
          <Pressable
            onPress={() => router.replace('/(auth)/magic-link')}
            className="rounded-atp py-4 items-center bg-atp-green active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
              Send a new link
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace('/(auth)/welcome')}
            className="rounded-atp py-4 items-center bg-atp-dark-3"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
              Back to sign-in
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-atp-black items-center justify-center px-8">
      <ActivityIndicator color={colors.green} size="large" />
      <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-base mt-6">
        Signing you in…
      </Text>
    </View>
  );
}
