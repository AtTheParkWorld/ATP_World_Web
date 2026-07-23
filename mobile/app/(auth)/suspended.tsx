import { WEB_BASE } from '@/lib/api/client';
/**
 * Account-suspended screen. Reached when login / register / Apple /
 * Google / magic-link verification all throw AccountSuspendedError
 * (server returns 403 with /suspended/i in the message).
 *
 * App Store 5.6 expects that a banned user has a path to appeal. We
 * point them at the existing web /appeal page via deep link — no need
 * to duplicate the form in-app.
 */
import { Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { colors, fontFamily } from '@/lib/theme/tokens';

const APPEAL_URL =
  (Constants.expoConfig?.extra as any)?.appealUrl ||
  `${WEB_BASE}/appeal`;

export default function Suspended() {
  return (
    <View className="flex-1 bg-atp-black px-6 pt-24 pb-12 justify-between">
      <View>
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-red text-4xl uppercase tracking-tight">
          Account{'\n'}suspended.
        </Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-base mt-4 leading-relaxed">
          Your ATP account is currently suspended. You can appeal this decision; our team usually replies within 48 hours.
        </Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm mt-4 leading-relaxed">
          If you think this was a mistake, please include any context that helps us understand what happened.
        </Text>
      </View>

      <View className="gap-2">
        <Pressable
          onPress={() => Linking.openURL(APPEAL_URL)}
          className="rounded-atp py-4 items-center bg-atp-green active:opacity-80"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
            Submit an appeal
          </Text>
        </Pressable>
        <Pressable
          onPress={() => Linking.openURL('mailto:support@atthepark.world?subject=Account%20suspension%20appeal')}
          className="rounded-atp py-4 items-center bg-atp-dark-3"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
            Email support
          </Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/(auth)/welcome')} className="py-3 items-center">
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">
            Back to sign-in
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
