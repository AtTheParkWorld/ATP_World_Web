/**
 * Email + password login screen.
 *
 * Single Pressable submits; the API helper handles token persistence
 * + suspended-account redirect. On a 401 we keep the form filled so
 * the user can fix a typo without re-typing everything.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Link } from 'expo-router';
import { login, AccountSuspendedError } from '@/lib/api/auth';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { ApiError } from '@/lib/api/client';

export default function Login() {
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !pass) {
      setError('Email and password required.');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim().toLowerCase(), pass);
      router.replace('/(tabs)/home');
    } catch (err) {
      if (err instanceof AccountSuspendedError) {
        router.replace('/(auth)/suspended');
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        setError('Wrong email or password.');
      } else {
        setError((err as Error).message || 'Login failed. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-atp-black"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 80, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={{ fontFamily: fontFamily.displayBlack }}
          className="text-atp-white text-4xl uppercase tracking-tight"
        >
          Welcome{'\n'}back.
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

          <View>
            <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-muted text-xs uppercase tracking-widest mb-2">
              Password
            </Text>
            <TextInput
              value={pass}
              onChangeText={setPass}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
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
              {busy ? 'Logging in…' : 'Log in'}
            </Text>
          </Pressable>

          <Link href="/(auth)/magic-link" asChild>
            <Pressable className="py-3 items-center">
              <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-sm">
                Forgot your password?  <Text className="text-atp-green">Email me a link</Text>
              </Text>
            </Pressable>
          </Link>

          <Link href="/(auth)/register" asChild>
            <Pressable className="py-3 items-center">
              <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">
                New to ATP?  <Text className="text-atp-green">Create account</Text>
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
