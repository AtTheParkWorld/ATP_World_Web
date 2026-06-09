/**
 * Google Sign-In. Uses expo-auth-session's Google provider — handles
 * the OAuth handshake natively (no WebView). The id_token returned by
 * Google is verified server-side via the existing /auth/google route.
 *
 * Required app.json `extra` keys (filled before the first real build):
 *   googleIosClientId    iOS OAuth client ID from Google Cloud Console
 *   googleAndroidClientId
 *   googleWebClientId    used as audience for id_token verification
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { signInWithGoogle, AccountSuspendedError } from '@/lib/api/auth';
import { colors, fontFamily } from '@/lib/theme/tokens';

// Required by Google Sign-In to dismiss the auth session after redirect.
WebBrowser.maybeCompleteAuthSession();

const extra = (Constants.expoConfig?.extra || {}) as Record<string, string>;

export default function GoogleSignInScreen() {
  const [error, setError]   = useState<string | null>(null);
  const [busy,  setBusy]    = useState(false);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId:     extra.googleIosClientId,
    androidClientId: extra.googleAndroidClientId,
    webClientId:     extra.googleWebClientId,
  });

  useEffect(() => {
    if (response?.type === 'success' && response.params.id_token) {
      (async () => {
        setBusy(true);
        try {
          await signInWithGoogle(response.params.id_token);
          router.replace('/(tabs)/home');
        } catch (err) {
          if (err instanceof AccountSuspendedError) {
            router.replace('/(auth)/suspended');
            return;
          }
          setError((err as Error).message || 'Google sign-in failed.');
        } finally {
          setBusy(false);
        }
      })();
    } else if (response?.type === 'error') {
      setError('Google sign-in returned an error.');
    }
  }, [response]);

  return (
    <View className="flex-1 bg-atp-black justify-between px-6 pt-24 pb-12">
      <View>
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-4xl uppercase tracking-tight">
          Continue{'\n'}with Google.
        </Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-base mt-4 leading-relaxed">
          We'll only use your name + email to set up your profile. Nothing else.
        </Text>
      </View>

      <View className="gap-3">
        <Pressable
          onPress={() => promptAsync()}
          disabled={!request || busy}
          className={`rounded-atp py-4 items-center ${(!request || busy) ? 'bg-atp-dark-3' : 'bg-atp-white active:opacity-80'}`}
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
            {busy ? 'Signing in…' : 'G  Continue with Google'}
          </Text>
        </Pressable>
        {!!error && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm">
            {error}
          </Text>
        )}
        {!extra.googleWebClientId && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.warning }} className="text-xs text-center mt-2">
            Google client IDs not configured yet. Set extra.google*ClientId in app.json.
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
