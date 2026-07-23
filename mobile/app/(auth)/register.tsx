/**
 * Account creation screen. Captures first + last + email + password.
 * Phone is collected later in the onboarding profile-setup screen so
 * we don't overwhelm the very first form.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Link } from 'expo-router';
import { register } from '@/lib/api/auth';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { ApiError } from '@/lib/api/client';

export default function Register() {
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [email,     setEmail]     = useState('');
  const [pass,      setPass]      = useState('');
  const [referral,  setReferral]  = useState('');
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !pass) {
      setError('All fields are required.');
      return;
    }
    if (pass.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await register({
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        email:      email.trim().toLowerCase(),
        password:   pass,
        referral_code: referral.trim() || undefined,
      });
      // Send brand-new members through onboarding so they pick a tribe
      // + city + opt into notifications, plus earn the +200 pts bonus.
      router.replace('/onboarding/welcome');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('An account with that email already exists. Try logging in.');
      } else {
        setError((err as Error).message || 'Signup failed. Try again.');
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
          Create{'\n'}your account.
        </Text>

        <View className="mt-10 gap-3">
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-muted text-xs uppercase tracking-widest mb-2">First name</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                textContentType="givenName"
                placeholder="Fredy"
                placeholderTextColor={colors.muted}
                style={{ fontFamily: fontFamily.body, color: colors.white }}
                className="bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-3 text-base"
              />
            </View>
            <View className="flex-1">
              <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-muted text-xs uppercase tracking-widest mb-2">Last name</Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                textContentType="familyName"
                placeholder="Martins"
                placeholderTextColor={colors.muted}
                style={{ fontFamily: fontFamily.body, color: colors.white }}
                className="bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-3 text-base"
              />
            </View>
          </View>

          <View>
            <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-muted text-xs uppercase tracking-widest mb-2">Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              style={{ fontFamily: fontFamily.body, color: colors.white }}
              className="bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-3 text-base"
            />
          </View>

          <View>
            <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-muted text-xs uppercase tracking-widest mb-2">Password</Text>
            <TextInput
              value={pass}
              onChangeText={setPass}
              secureTextEntry
              autoComplete="password-new"
              textContentType="newPassword"
              placeholderTextColor={colors.muted}
              style={{ fontFamily: fontFamily.body, color: colors.white }}
              className="bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-3 text-base"
            />
            <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-xs mt-1">
              At least 8 characters.
            </Text>
          </View>

          <View>
            <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-muted text-xs uppercase tracking-widest mb-2">Referral code (optional)</Text>
            <TextInput
              value={referral}
              onChangeText={(t) => setReferral(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Friend's code"
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
              {busy ? 'Creating account…' : 'Create account'}
            </Text>
          </Pressable>

          <Link href="/(auth)/login" asChild>
            <Pressable className="py-3 items-center">
              <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">
                Already have an account?  <Text className="text-atp-green">Log in</Text>
              </Text>
            </Pressable>
          </Link>

          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-xs text-center mt-4 leading-relaxed">
            By creating an account you agree to our Terms & Privacy Policy.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
