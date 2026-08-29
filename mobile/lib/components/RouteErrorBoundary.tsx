/**
 * Route-level error boundary (founder 2026-09-19: the coach dashboard
 * crashed the whole app on iOS, leaving nothing to diagnose).
 *
 * Expo Router renders an exported `ErrorBoundary` from a layout when a
 * screen in that segment throws. Two wins: a member gets a readable
 * screen with a way out instead of the app disappearing, and the error
 * text is on screen — one screenshot is a diagnosis.
 */
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors, fontFamily } from '@/lib/theme/tokens';

export function RouteErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase">
          Something broke
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2">
          This screen hit an error. The rest of the app is fine — and the details below tell us exactly what to fix.
        </Text>

        <View className="bg-atp-dark border border-white/10 rounded-atp-lg p-4 mt-5">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-xs uppercase tracking-widest mb-2">
            Error
          </Text>
          <Text selectable style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
            {error?.message || String(error)}
          </Text>
          {!!error?.stack && (
            <Text selectable style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] mt-3">
              {String(error.stack).split('\n').slice(0, 6).join('\n')}
            </Text>
          )}
        </View>

        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-3">
          Screenshot this and send it to Fredy — it names the exact line.
        </Text>

        <Pressable
          onPress={retry}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
          className="bg-atp-green rounded-atp py-4 items-center mt-6 active:opacity-80"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
            Try again
          </Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)/home')} className="py-4 items-center active:opacity-70">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm uppercase tracking-widest">
            Back to home
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
