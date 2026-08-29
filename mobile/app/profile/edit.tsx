/**
 * Edit profile — full parity with the website form (founder 2026-09-10:
 * the app was missing country, city, activities, tribe, volleyball
 * level, email visibility and any way to change a password).
 *
 * Everything here is already accepted by PATCH /members/profile; the
 * screen simply never offered it. Email is shown read-only (there is no
 * self-serve email-change endpoint — support handles it), and the
 * password section posts to /auth/change-password.
 */
import { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfile, patchProfile, patchAvatar } from '@/lib/api/members';
import { listCities, listTribes, listActivities } from '@/lib/api/sessions';
import { changePassword } from '@/lib/api/auth';
import { WORLD_COUNTRIES } from '@/lib/data/countries';
import { pickAndUploadMedia } from '@/lib/api/upload';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Avatar } from '@/lib/components/Avatar';
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
    padel_level:      '',
    volleyball_level: '',
  });
  // Residence is free text (any country/city in the world); the ATP
  // city stays an id because it drives which sessions you see.
  const [resCountry, setResCountry] = useState('');
  const [resCity,    setResCity]    = useState('');
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [cityId,    setCityId]    = useState<string | null>(null);
  const [tribeId,   setTribeId]   = useState<string | null>(null);
  const [sports,    setSports]    = useState<string[]>([]);

  // Password change (collapsed until tapped)
  const [pwOpen, setPwOpen]   = useState(false);
  const [pwCur,  setPwCur]    = useState('');
  const [pwNew,  setPwNew]    = useState('');
  const [pwNew2, setPwNew2]   = useState('');

  const citiesQ     = useQuery({ queryKey: ['cities'],     queryFn: () => listCities().then(r => r.cities),        staleTime: 1000 * 60 * 30 });
  const tribesQ     = useQuery({ queryKey: ['tribes'],     queryFn: () => listTribes().then(r => r.tribes),        staleTime: 1000 * 60 * 30 });
  const activitiesQ = useQuery({ queryKey: ['activities'], queryFn: () => listActivities().then(r => r.activities), staleTime: 1000 * 60 * 30 });

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
      padel_level:      profileQ.data.padel_level      || '',
      volleyball_level: profileQ.data.volleyball_level || '',
    });
    const d = profileQ.data;
    setResCountry(d.residence_country || '');
    setResCity(d.residence_city || '');
    setCityId(d.city_id ? String(d.city_id) : null);
    setTribeId(d.tribe_id ? String(d.tribe_id) : null);
    // sports_preferences stores activity NAMES (same as the website).
    let prefs = d.sports_preferences;
    if (typeof prefs === 'string') { try { prefs = JSON.parse(prefs); } catch { prefs = []; } }
    setSports(Array.isArray(prefs) ? prefs : []);
  }, [profileQ.data]);

  const avatarMu = useMutation({
    mutationFn: async () => {
      const picked = await pickAndUploadMedia({ kind: 'avatar' });
      if (!picked) return null;
      if (!picked.content_type.startsWith('image/')) {
        throw new Error('Please pick an image (not a video) for your profile photo.');
      }
      await patchAvatar(picked.public_url);
      return picked.public_url;
    },
    onSuccess: async (url) => {
      if (!url) return;
      await qc.invalidateQueries({ queryKey: ['profile'] });
      const refreshed = await getProfile().then(r => r.member);
      updateMember(refreshed as any);
    },
    onError: (err) => Alert.alert('Could not update photo', (err as Error).message || 'Try again.'),
  });

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
      padel_level:      form.padel_level         || undefined,
      volleyball_level: form.volleyball_level    || undefined,
      residence_country: resCountry.trim() || undefined,
      residence_city:    resCity.trim()    || undefined,
      city_id:       cityId    ?? undefined,
      tribe_id:      tribeId   ?? undefined,
      sports_preferences: sports,
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['profile'] });
      const refreshed = await getProfile().then(r => r.member);
      updateMember(refreshed as any);
      router.back();
    },
    onError: (err) => Alert.alert('Could not save', (err as Error).message || 'Try again.'),
  });

  const pwMu = useMutation({
    mutationFn: () => changePassword(pwCur, pwNew),
    onSuccess: () => {
      setPwCur(''); setPwNew(''); setPwNew2(''); setPwOpen(false);
      Alert.alert('Password updated', 'Use your new password next time you sign in.');
    },
    onError: (err) => Alert.alert('Could not change password', (err as Error).message || 'Try again.'),
  });

  const submitPassword = () => {
    if (pwNew.length < 8) { Alert.alert('Too short', 'Your new password needs at least 8 characters.'); return; }
    if (pwNew !== pwNew2) { Alert.alert('They don\u2019t match', 'The two new-password fields are different.'); return; }
    pwMu.mutate();
  };

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
          {/* Avatar — tap to swap */}
          <View className="items-center mb-7">
            <Pressable onPress={() => avatarMu.mutate()} disabled={avatarMu.isPending}>
              <Avatar
                uri={profileQ.data?.avatar_url}
                firstName={profileQ.data?.first_name}
                lastName={profileQ.data?.last_name}
                id={profileQ.data?.id}
                size="xl"
                borderColor={colors.green}
                borderWidth={2}
              />
            </Pressable>
            <Pressable
              onPress={() => avatarMu.mutate()}
              disabled={avatarMu.isPending}
              className="mt-3 px-4 py-2 rounded-atp border border-atp-green/40 bg-atp-green/10 active:opacity-70"
            >
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: colors.green, letterSpacing: 1 }}
                className="text-xs uppercase"
              >
                {avatarMu.isPending ? 'Uploading…' : (profileQ.data?.avatar_url ? 'Change photo' : 'Add photo')}
              </Text>
            </Pressable>
          </View>

          <Field label="First name"  value={form.first_name}    onChange={(v) => setForm((f) => ({ ...f, first_name: v }))} autoCapitalize="words" textContentType="givenName" />
          <Field label="Last name"   value={form.last_name}     onChange={(v) => setForm((f) => ({ ...f, last_name: v }))}  autoCapitalize="words" textContentType="familyName" />
          <Field label="Phone"       value={form.phone}         onChange={(v) => setForm((f) => ({ ...f, phone: v }))}      keyboardType="phone-pad" textContentType="telephoneNumber" />
          <Field label="Date of birth (YYYY-MM-DD)" value={form.date_of_birth} onChange={(v) => setForm((f) => ({ ...f, date_of_birth: v }))} keyboardType="numbers-and-punctuation" />
          <Field label="Gender"      value={form.gender}        onChange={(v) => setForm((f) => ({ ...f, gender: v }))} />
          <Field label="Nationality" value={form.nationality}   onChange={(v) => setForm((f) => ({ ...f, nationality: v }))} autoCapitalize="words" />

          {/* ── Where I live ─────────────────────────────────── */}
          <SectionHeader label="Where I live" />
          <View className="mb-4">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Country
            </Text>
            <Pressable
              onPress={() => { setCountrySearch(''); setCountryPickerOpen(true); }}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.99 : 1 }] })}
              className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 flex-row items-center justify-between active:opacity-80"
            >
              <Text
                style={{ fontFamily: fontFamily.body, color: resCountry ? colors.white : colors.muted }}
                className="text-base"
              >
                {resCountry || 'Select your country'}
              </Text>
              <Text style={{ color: colors.muted }}>▾</Text>
            </Pressable>
          </View>
          <Field label="City" value={resCity} onChange={setResCity} autoCapitalize="words" />

          {/* ── Training ─────────────────────────────────────── */}
          <SectionHeader label="Training" />
          <ChipPicker
            label="My ATP city (where I train)"
            options={(citiesQ.data || []).map((c: any) => ({ key: String(c.id), label: c.name }))}
            selectedKey={cityId}
            onSelect={setCityId}
            empty="No ATP cities configured yet."
          />
          <ChipPicker
            label="Favourite tribe"
            options={(tribesQ.data || []).map((tr) => ({ key: String(tr.id), label: tr.name }))}
            selectedKey={tribeId}
            onSelect={setTribeId}
            empty="No tribes configured yet."
          />
          <MultiChipPicker
            label="Favourite activities"
            options={(activitiesQ.data || []).map((a) => ({ key: a.name, label: `${a.icon ? a.icon + ' ' : ''}${a.name}` }))}
            selected={sports}
            onToggle={(k) => setSports((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}
            empty="No activities configured yet."
          />
          <Field label="Padel level"      value={form.padel_level}      onChange={(v) => setForm((f) => ({ ...f, padel_level: v }))} />
          <Field label="Volleyball level" value={form.volleyball_level} onChange={(v) => setForm((f) => ({ ...f, volleyball_level: v }))} />

          {/* ── Kit ──────────────────────────────────────────── */}
          <SectionHeader label="Kit size" />
          <Field label="Top size"    value={form.top_size}      onChange={(v) => setForm((f) => ({ ...f, top_size: v }))} />
          <Field label="Bottom size" value={form.bottom_size}   onChange={(v) => setForm((f) => ({ ...f, bottom_size: v }))} />

          {/* ── Account ──────────────────────────────────────── */}
          <SectionHeader label="Account" />
          <View className="mb-4">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Email
            </Text>
            <View className="bg-atp-dark border border-white/5 rounded-atp px-4 py-3">
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base">
                {profileQ.data?.email || '—'}
              </Text>
            </View>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-1.5">
              Your email is your sign-in — ATP support can change it for you (Profile → Help & support).
            </Text>
          </View>

          {!pwOpen ? (
            <Pressable
              onPress={() => setPwOpen(true)}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
              className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3.5 active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                Change my password
              </Text>
            </Pressable>
          ) : (
            <View className="bg-atp-dark border border-white/10 rounded-atp p-4">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm mb-3">
                Change my password
              </Text>
              <Field label="Current password" value={pwCur}  onChange={setPwCur}  secureTextEntry />
              <Field label="New password"     value={pwNew}  onChange={setPwNew}  secureTextEntry />
              <Field label="Repeat new password" value={pwNew2} onChange={setPwNew2} secureTextEntry />
              <View className="flex-row gap-2">
                <Pressable
                  onPress={submitPassword}
                  disabled={pwMu.isPending}
                  className={`flex-1 rounded-atp py-3 items-center ${pwMu.isPending ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
                >
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">
                    {pwMu.isPending ? 'Saving…' : 'Update password'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => { setPwOpen(false); setPwCur(''); setPwNew(''); setPwNew2(''); }}
                  className="px-4 rounded-atp border border-white/10 items-center justify-center active:opacity-70"
                >
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs uppercase tracking-widest">
                    Cancel
                  </Text>
                </Pressable>
              </View>
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-2">
                At least 8 characters. Signed in with Apple or Google? You may not have a password yet — leave "current" blank.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country picker — 198 entries, so it's a searchable sheet
          rather than a chip wall. */}
      <Modal visible={countryPickerOpen} animationType="slide" transparent onRequestClose={() => setCountryPickerOpen(false)}>
        <View className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <View className="flex-1 mt-24 bg-atp-black rounded-t-3xl border-t border-white/10 overflow-hidden">
            <View className="px-5 pt-4 pb-3 flex-row items-center border-b border-white/5">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase flex-1">
                Select country
              </Text>
              <Pressable onPress={() => setCountryPickerOpen(false)} hitSlop={10} className="px-2 py-1">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-base">✕</Text>
              </Pressable>
            </View>
            <View className="px-5 py-3">
              <TextInput
                value={countrySearch}
                onChangeText={setCountrySearch}
                placeholder="Search…"
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                style={{ fontFamily: fontFamily.body, color: colors.white }}
                className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 text-base"
              />
            </View>
            <FlatList
              data={WORLD_COUNTRIES.filter((c) => c.toLowerCase().includes(countrySearch.trim().toLowerCase()))}
              keyExtractor={(c) => c}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
              renderItem={({ item }) => {
                const on = item === resCountry;
                return (
                  <Pressable
                    onPress={() => { setResCountry(item); setCountryPickerOpen(false); }}
                    className={`px-4 py-3.5 mb-1.5 rounded-atp border ${on ? 'bg-atp-green/10 border-atp-green/40' : 'bg-atp-dark border-white/5'}`}
                  >
                    <Text
                      style={{ fontFamily: on ? fontFamily.bodyBold : fontFamily.body, color: on ? colors.green : colors.white }}
                      className="text-base"
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm px-1">
                  No country matches that search.
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Text
      style={{ fontFamily: fontFamily.bodyBold, color: colors.green }}
      className="text-[11px] uppercase tracking-widest mt-3 mb-3"
    >
      {label}
    </Text>
  );
}

/** Single-select chip row — tapping the selected chip clears it. */
function ChipPicker(props: {
  label: string;
  options: { key: string; label: string }[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  empty?: string;
}) {
  return (
    <View className="mb-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
        {props.label}
      </Text>
      {props.options.length === 0 ? (
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
          {props.empty || 'Nothing to pick yet.'}
        </Text>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {props.options.map((o) => {
            const on = props.selectedKey === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => props.onSelect(on ? null : o.key)}
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
                className={`rounded-full px-3.5 py-2 border ${on ? 'bg-atp-green border-atp-green' : 'bg-atp-dark border-white/10'}`}
              >
                <Text
                  style={{ fontFamily: fontFamily.bodyBold, color: on ? colors.black : colors.light }}
                  className="text-xs"
                >
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Multi-select chips (activities). */
function MultiChipPicker(props: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  empty?: string;
}) {
  return (
    <View className="mb-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
        {props.label}
      </Text>
      {props.options.length === 0 ? (
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
          {props.empty || 'Nothing to pick yet.'}
        </Text>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {props.options.map((o) => {
            const on = props.selected.includes(o.key);
            return (
              <Pressable
                key={o.key}
                onPress={() => props.onToggle(o.key)}
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
                className={`rounded-full px-3.5 py-2 border ${on ? 'bg-atp-green border-atp-green' : 'bg-atp-dark border-white/10'}`}
              >
                <Text
                  style={{ fontFamily: fontFamily.bodyBold, color: on ? colors.black : colors.light }}
                  className="text-xs"
                >
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Field(props: {
  label: string; value: string; onChange: (v: string) => void;
  keyboardType?: any; autoCapitalize?: any; textContentType?: any; secureTextEntry?: boolean;
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
        secureTextEntry={props.secureTextEntry}
        placeholderTextColor={colors.muted}
        style={{ fontFamily: fontFamily.body, color: colors.white }}
        className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 text-base"
      />
    </View>
  );
}
