/**
 * Onboarding step 4 — enable push notifications.
 *
 * iOS shows the system prompt the first time we request permission.
 * Declining isn't fatal — the member can re-enable later from
 * Profile → Notifications.
 *
 * We use OneSignal's native permission flow once the SDK is wired
 * (Phase 8); for now we fall back to expo-notifications so the
 * onboarding flow ships even before OneSignal is fully initialised.
 */
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function OnboardingNotifications() {
  const [busy, setBusy] = useState(false);

  async function enablePush() {
    setBusy(true);
    try {
      // OneSignal owns push (initialized in app/_layout.tsx). The old
      // expo-notifications dynamic import broke Metro bundling — the
      // package was never installed.
      const { OneSignal } = require('react-native-onesignal');
      const granted = await OneSignal.Notifications.requestPermission(true);
      if (!granted) {
        Alert.alert(
          'Notifications off',
          'No problem — you can enable session reminders any time from Profile → Notifications.'
        );
      }
      router.replace('/onboarding/done');
    } catch (err) {
      // Permission denial is fine; treat any failure as "skip"
      router.replace('/onboarding/done');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top', 'bottom']}>
      <View className="flex-1 px-6 justify-between py-12">
        <View className="mt-12">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs uppercase tracking-widest">
            Step 3 of 3
          </Text>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl uppercase tracking-tight mt-2">
            Stay in{'\n'}the loop.
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-3 leading-relaxed">
            We'll only ping you for things you actually want:
          </Text>

          <View className="mt-5 gap-3">
            {[
              ['⏰', 'Session reminders — 24h + 1h before any session you book'],
              ['🔥', 'Streak saves — "3h left to keep your streak alive"'],
              ['💬', 'Friend requests, likes, and comments'],
              ['🎁', 'New rewards + expiring points'],
            ].map(([emoji, text]) => (
              <View key={text} className="flex-row items-start gap-3">
                <Text style={{ fontSize: 20 }}>{emoji}</Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base flex-1">
                  {text}
                </Text>
              </View>
            ))}
          </View>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-5">
            No marketing spam. Disable individual channels in Profile → Notifications.
          </Text>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={enablePush}
            disabled={busy}
            className="bg-atp-green rounded-atp py-4 items-center active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              {busy ? 'Asking…' : 'Enable notifications'}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/onboarding/done')} className="py-3 items-center">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              Not now
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
