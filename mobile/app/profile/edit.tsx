/**
 * Edit profile form. Covers the high-value fields only:
 *   first/last name, phone, date_of_birth (text), gender, nationality,
 *   city, top size, bottom size, padel level.
 *
 * Tribe is intentionally not editable here — that's a separate
 * onboarding flow because changing tribe mid-membership affects
 * leaderboards. Avatar upload waits on the R2 signed-PUT plumbing,
 * coming in Phase 7/8.
 */
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfile, patchProfile } from '@/lib/api/members';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function EditProfile() {
  const qc = useQueryClient();
  const updateMember = useAuthStore((s) => s.updateMember);

  const profileQ = useQuery({ queryKey: ['profile'], queryFn: () => getProfile().then(r => r.member) });

  const [form, setForm] = useState({
    first_name:    '',
    last_name:     '',
    phone:         '',
    date_of_birth: '',
    gender:        '',
    nationality:   '',
    top_size:      '',
    bottom_size:   '',
    padel_level:   '',
  });

  useEffect(() => {
    if (!profileQ.data) return;
    setForm({
      first_name:    profileQ.data.first_name    || '',
      last_name:     profileQ.data.last_name     || '',
      phone:         profileQ.data.phone         || '',
      date_of_birth: profileQ.data.date_of_birth ? profileQ.data.date_of_birth.slice(0, 10) : '',
      gender:        profileQ.data.gender        || '',
      nationality:   profileQ.data.nationality   || '',
      top_size:      profileQ.data.top_size      || '',
      bottom_size:   profileQ.data.bottom_size   || '',
      padel_level:   profileQ.data.padel_level   || '',
    });
  }, [profileQ.data]);

  const saveMu = useMutation({
    mutationFn: () => patchProfile({
      first_name:    form.first_name.trim() || undefined,
      last_name:     form.last_name.trim()  || undefined,
      phone:         form.phone.trim()       || undefined,
      date_of_birth: form.date_of_birth     || undefined,
      gender:        form.gender             || undefined,
      nationality:   form.nationality.trim() || undefined,
      top_size:      form.top_size            || undefined,
      bottom_size:   form.bottom_size         || undefined,
      padel_level:   form.padel_level         || undefined,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['profile'] });
      const refreshed = await getProfile().then(r => r.member);
      updateMember(refreshed as any);
      router.back();
    },
    onError: (err) => Alert.alert('Could not save', (err as Error).message || 'Try again.'),
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-white/5">
          <Pressable onPress={() => router.back()} className="py-2 -ml-2">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>Cancel</Text>
          </Pressable>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
            Edit profile
          </Text>
          <Pressable
            onPress={() => saveMu.mutate()}
            disabled={saveMu.isPending}
            className={`px-4 py-2 rounded-atp ${saveMu.isPending ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
              {saveMu.isPending ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Field label="First name"  value={form.first_name}    onChange={(v) => setForm((f) => ({ ...f, first_name: v }))} autoCapitalize="words" textContentType="givenName" />
          <Field label="Last name"   value={form.last_name}     onChange={(v) => setForm((f) => ({ ...f, last_name: v }))}  autoCapitalize="words" textContentType="familyName" />
          <Field label="Phone"       value={form.phone}         onChange={(v) => setForm((f) => ({ ...f, phone: v }))}      keyboardType="phone-pad" textContentType="telephoneNumber" />
          <Field label="Date of birth (YYYY-MM-DD)" value={form.date_of_birth} onChange={(v) => setForm((f) => ({ ...f, date_of_birth: v }))} keyboardType="numbers-and-punctuation" />
          <Field label="Gender"      value={form.gender}        onChange={(v) => setForm((f) => ({ ...f, gender: v }))} />
          <Field label="Nationality" value={form.nationality}   onChange={(v) => setForm((f) => ({ ...f, nationality: v }))} autoCapitalize="words" />
          <Field label="Top size"    value={form.top_size}      onChange={(v) => setForm((f) => ({ ...f, top_size: v }))} />
          <Field label="Bottom size" value={form.bottom_size}   onChange={(v) => setForm((f) => ({ ...f, bottom_size: v }))} />
          <Field label="Padel level" value={form.padel_level}   onChange={(v) => setForm((f) => ({ ...f, padel_level: v }))} />

          <View className="mt-4 bg-atp-dark border border-white/5 rounded-atp p-3">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
              Email + tribe changes are managed by ATP support. Need a change? Tap Help & support on Profile.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string; value: string; onChange: (v: string) => void;
  keyboardType?: any; autoCapitalize?: any; textContentType?: any;
}) {
  return (
    <View className="mb-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
        {props.label}
      </Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize || 'none'}
        textContentType={props.textContentType}
        placeholderTextColor={colors.muted}
        style={{ fontFamily: fontFamily.body, color: colors.white }}
        className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 text-base"
      />
    </View>
  );
}
