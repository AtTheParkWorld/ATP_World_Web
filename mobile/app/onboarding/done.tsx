/**
 * Onboarding step 5 — completion celebration. Awards +200 pts via
 * the existing profile-completion trigger (backend recomputes
 * profile_complete_pct on every PATCH /profile, and the streak
 * service auto-credits the bonus when pct hits 100).
 *
 * For onboarding that didn't fully complete the profile (e.g.
 * member skipped city), we still send them to Home — the +200 bonus
 * just won't trigger until they finish the missing fields in
 * Profile → Edit profile.
 */
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function OnboardingDone() {
  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top', 'bottom']}>
      <View className="flex-1 px-6 justify-center items-center py-12">
        <Text style={{ fontSize: 80 }}>🎉</Text>
        <Text
          style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
          className="text-5xl uppercase tracking-tight text-center mt-5 leading-[1.02]"
        >
          You're{'\n'}in.
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-5 text-center px-4 leading-relaxed">
          Pick a free session, show up, and meet your tribe. We'll be there.
        </Text>

        <View className="bg-atp-green/10 border border-atp-green/40 rounded-atp px-5 py-3 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm uppercase tracking-widest text-center">
            +200 points earned
          </Text>
        </View>

        <View className="absolute bottom-12 left-6 right-6 gap-2">
          <Pressable
            onPress={() => router.replace('/(tabs)/sessions')}
            className="bg-atp-green rounded-atp py-4 items-center active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              Find my first session
            </Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/(tabs)/home')} className="py-3 items-center">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              Go to home
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
