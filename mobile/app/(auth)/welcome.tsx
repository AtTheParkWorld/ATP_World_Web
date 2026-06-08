/**
 * Welcome screen — first thing every signed-out user sees.
 *
 * Layout: hero copy + ATP logo, then 3 stacked CTAs (Apple → Google →
 * Email magic link). Apple is FIRST per App Store guideline 4.8 when
 * any third-party social auth is offered.
 *
 * Apple Sign-In button is iOS-only (Platform.OS check). On Android the
 * button is hidden and Google moves to the top.
 */
import { Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function Welcome() {
  return (
    <View className="flex-1 justify-between bg-atp-black px-6 pt-24 pb-12">
      <View>
        <Text
          style={{ fontFamily: fontFamily.displayBlack }}
          className="text-atp-white text-5xl leading-[1.02] uppercase tracking-tight"
        >
          Never{'\n'}train{'\n'}alone.
        </Text>
        <Text
          style={{ fontFamily: fontFamily.body }}
          className="text-atp-light text-base mt-6 leading-relaxed"
        >
          Free outdoor fitness sessions, every day, across Dubai, Al Ain, Abu Dhabi, and Muscat. Join 7,000+ members.
        </Text>
      </View>

      <View className="gap-3">
        {Platform.OS === 'ios' && (
          <Pressable
            onPress={() => router.push('/(auth)/apple-signin')}
            className="bg-atp-white rounded-atp py-4 items-center active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
               Continue with Apple
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => router.push('/(auth)/google-signin')}
          className="bg-atp-dark-3 border border-white/10 rounded-atp py-4 items-center active:opacity-80"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
            G  Continue with Google
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/(auth)/magic-link')}
          className="bg-atp-green rounded-atp py-4 items-center active:opacity-80"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
            Continue with email
          </Text>
        </Pressable>

        <Pressable onPress={() => router.push('/(auth)/login')} className="py-3 items-center">
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">
            Already have an account?  <Text className="text-atp-green">Log in</Text>
          </Text>
        </Pressable>

        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-xs text-center mt-2">
          By continuing you agree to our{' '}
          <Text className="text-atp-light underline">Terms</Text> &{' '}
          <Text className="text-atp-light underline">Privacy Policy</Text>.
        </Text>
      </View>
    </View>
  );
}
