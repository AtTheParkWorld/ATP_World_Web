/**
 * Apple Sign-In screen — iOS only. Uses expo-apple-authentication's
 * native sheet; verification happens server-side via /auth/apple
 * (v1.69+) against Apple's JWKS.
 *
 * On Android this screen is unreachable (Welcome hides the Apple
 * button); if someone gets here via deep link we fall through with a
 * notice.
 */
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { signInWithApple, AccountSuspendedError } from '@/lib/api/auth';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function AppleSignInScreen() {
  const [error,     setError]     = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setSupported);
  }, []);

  async function start() {
    setError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        setError('Apple did not return an identity token. Try again.');
        return;
      }
      await signInWithApple({
        identity_token: credential.identityToken,
        full_name:      credential.fullName
          ? { givenName: credential.fullName.givenName, familyName: credential.fullName.familyName }
          : undefined,
      });
      router.replace('/(tabs)/home');
    } catch (err: any) {
      if (err instanceof AccountSuspendedError) {
        router.replace('/(auth)/suspended');
        return;
      }
      // User cancelled the system sheet — silent, no error message.
      if (err && err.code === 'ERR_REQUEST_CANCELED') return;
      setError(err?.message || 'Sign-In with Apple failed.');
    }
  }

  if (Platform.OS !== 'ios') {
    return (
      <View className="flex-1 items-center justify-center bg-atp-black px-8">
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-center">
          Sign in with Apple is only available on iOS. Try Google or email.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-atp-black justify-between px-6 pt-24 pb-12">
      <View>
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-4xl uppercase tracking-tight">
          Continue{'\n'}with Apple.
        </Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-base mt-4 leading-relaxed">
          We'll never see your password. Apple can keep your email private with their hide-my-email service.
        </Text>
      </View>

      <View className="gap-3">
        {supported && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={10}
            style={{ width: '100%', height: 52 }}
            onPress={start}
          />
        )}
        {supported === false && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm">
            This device does not support Sign in with Apple.
          </Text>
        )}
        {!!error && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm">
            {error}
          </Text>
        )}
        <Pressable onPress={() => router.back()} className="py-3 items-center">
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">
            Back
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
