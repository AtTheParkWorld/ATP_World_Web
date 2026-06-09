/**
 * Magic-link request screen. User enters email, server emails a link
 * that opens the app via universal link → /(auth)/magic-link-callback.
 *
 * We don't reveal whether the email is registered (anti-enum) — backend
 * always returns 200 and we always show the same "check your inbox"
 * confirmation.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Link } from 'expo-router';
import { requestMagicLink } from '@/lib/api/auth';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function MagicLink() {
  const [email, setEmail]   = useState('');
  const [busy,  setBusy]    = useState(false);
  const [sent,  setSent]    = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    setBusy(true);
    try {
      await requestMagicLink(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError((err as Error).message || 'Could not send link. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <View className="flex-1 bg-atp-black px-6 pt-24 pb-12 justify-between">
        <View>
          <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-green text-4xl uppercase tracking-tight">
            Check{'\n'}your inbox.
          </Text>
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-base mt-4 leading-relaxed">
            If <Text className="text-atp-white">{email}</Text> matches an ATP account, you'll get a link in a few seconds. Tap it on this device to sign in.
          </Text>
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm mt-3">
            Link is valid for 15 minutes.
          </Text>
        </View>
        <Pressable onPress={() => router.replace('/(auth)/welcome')} className="rounded-atp py-4 items-center bg-atp-dark-3">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
            Done
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-atp-black">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 80, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-4xl uppercase tracking-tight">
          Email me{'\n'}a link.
        </Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-base mt-4 leading-relaxed">
          No password needed. We'll send you a one-tap sign-in link.
        </Text>

        <View className="mt-10 gap-3">
          <View>
            <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-muted text-xs uppercase tracking-widest mb-2">
              Email
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="you@atthepark.com"
              placeholderTextColor={colors.muted}
              style={{ fontFamily: fontFamily.body, color: colors.white }}
              className="bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-3 text-base"
            />
          </View>

          {!!error && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm mt-1">
              {error}
            </Text>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={busy}
            className={`mt-3 rounded-atp py-4 items-center ${busy ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
              {busy ? 'Sending…' : 'Send link'}
            </Text>
          </Pressable>

          <Link href="/(auth)/login" asChild>
            <Pressable className="py-3 items-center">
              <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">
                Back to log in
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
