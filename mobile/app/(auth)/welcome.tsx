/**
 * Welcome screen — first thing every signed-out user sees.
 *
 * Founder 2026-08-30 flow fix: email + password is the FIRST option,
 * with "Forgot password" right below it (that starts the magic-link
 * flow). Apple / Google sign-in sit BELOW on the same page. Apple
 * stays present on iOS per App Store guideline 4.8 (it must be
 * offered when third-party auth exists — order is ours to choose).
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { login, AccountSuspendedError } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { Icon } from '@/lib/components/icons';

export default function Welcome() {
  const [email,    setEmail]    = useState('');
  const [pass,     setPass]     = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

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
      } else if (err instanceof ApiError && (err.data as any)?.code === 'NO_PASSWORD') {
        setError('This account uses magic link or social login — use "Forgot password" below or Apple/Google.');
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
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={{ fontFamily: fontFamily.displayBlack }}
          className="text-atp-white text-5xl leading-[1.02] uppercase tracking-tight"
        >
          Never{'\n'}train{'\n'}alone.
        </Text>
        <Text
          style={{ fontFamily: fontFamily.body }}
          className="text-atp-light text-sm mt-4 leading-relaxed"
        >
          Free outdoor fitness sessions, every day, across Dubai, Al Ain, Abu Dhabi, and Muscat. Join 7,000+ members.
        </Text>

        {/* 1 — email + password, the primary way in */}
        <View className="mt-8 gap-3">
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
            <View className="bg-atp-dark-3 border border-white/10 rounded-atp flex-row items-center">
              <TextInput
                value={pass}
                onChangeText={setPass}
                secureTextEntry={!showPass}
                autoComplete="password"
                textContentType="password"
                placeholderTextColor={colors.muted}
                style={{ fontFamily: fontFamily.body, color: colors.white }}
                className="flex-1 px-4 py-3 text-base"
              />
              <Pressable onPress={() => setShowPass(v => !v)} hitSlop={10} className="px-3 py-3">
                <Icon name="eye" size={18} color={showPass ? colors.green : colors.muted} />
              </Pressable>
            </View>
          </View>

          {/* 2 — forgot password right below → magic-link flow */}
          <Pressable onPress={() => router.push('/(auth)/magic-link')} className="items-start">
            <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-sm">
              Forgot password?  <Text className="text-atp-green">Email me a magic link</Text>
            </Text>
          </Pressable>

          {!!error && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm">
              {error}
            </Text>
          )}

          <Pressable
            onPress={onSubmit}
            disabled={busy}
            className={`mt-1 rounded-atp py-4 items-center ${busy ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
              {busy ? 'Logging in…' : 'Log in'}
            </Text>
          </Pressable>
        </View>

        {/* 3 — social sign-in below, same page */}
        <View className="flex-row items-center gap-3 my-6">
          <View className="flex-1 h-px bg-white/10" />
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-xs uppercase tracking-widest">
            or continue with
          </Text>
          <View className="flex-1 h-px bg-white/10" />
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
              Continue with Google
            </Text>
          </Pressable>

          <Pressable onPress={() => router.push('/(auth)/register')} className="py-3 items-center">
            <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">
              New to ATP?  <Text className="text-atp-green">Create account</Text>
            </Text>
          </Pressable>

          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-xs text-center">
            By continuing you agree to our{' '}
            <Text className="text-atp-light underline">Terms</Text> &{' '}
            <Text className="text-atp-light underline">Privacy Policy</Text>.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
