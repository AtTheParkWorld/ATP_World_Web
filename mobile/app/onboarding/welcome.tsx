/**
 * Onboarding step 1 — welcome screen for newly-registered members.
 *
 * Shown once per account after the first successful sign-in. The
 * Welcome → Tribe → City → Notifications → Done flow takes ~30 sec
 * and earns the +200 pts profile_complete bonus once finished.
 *
 * Skip-friendly: every step has a "Skip for now" link except the
 * tribe pick (which is required for the in-app feed to work).
 */
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function OnboardingWelcome() {
  const member = useAuthStore((s) => s.member) as any;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top', 'bottom']}>
      <View className="flex-1 px-6 justify-between py-12">
        <View className="mt-12">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-base uppercase tracking-widest">
            Welcome to ATP
          </Text>
          <Text
            style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
            className="text-5xl uppercase tracking-tight leading-[1.02] mt-3"
          >
            Never{'\n'}train{'\n'}alone,{'\n'}{member?.first_name || 'friend'}.
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-6 leading-relaxed">
            Let's get your account ready in 30 seconds. Pick a tribe, set your city, and enable session reminders.
          </Text>
          <View className="mt-6 gap-2">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              ⚡ Complete this and earn <Text style={{ color: colors.green, fontFamily: fontFamily.bodyBold }}>+200 points</Text>.
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              🛡  We never share your data. Skip any step.
            </Text>
          </View>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={() => router.push('/onboarding/tribe')}
            className="bg-atp-green rounded-atp py-4 items-center active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              Let's go →
            </Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/(tabs)/home')} className="py-3 items-center">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              Skip onboarding — set up later
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
