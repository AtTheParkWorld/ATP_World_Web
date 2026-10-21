/**
 * One 30x30 challenge (founder 2026-10-19) — same registration as the
 * website: individual = book a qualifier slot; team = the captain names
 * the team + books, then shares the invite (link / code); teammates join
 * and book the team slot. After registering, an optional charity ask opens
 * the charity's own donation page. Finals aren't bookable. The server
 * enforces one slot per day, team-first and no direct final.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBooking, listMyBookings } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { createHubTeam, kindLabel, hubWhen, ymdLabel } from '@/lib/api/hubChallenges';
import { SessionTerms } from '@/lib/components/SessionTerms';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { useHubData, HubEmpty as Empty, TeamCard, CharityAsk } from '@/lib/components/Hub30';
import { partnerFor, PartnerLogo, PoweredBy } from '@/lib/partners';

const GREEN2 = '#22c55e';



export default function HubChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { sessionsQ, challengesQ } = useHubData();
  const myQ = useQuery({ queryKey: ['bookings', 'mine'], queryFn: listMyBookings });
  const c = (challengesQ.data || []).find((x) => x.id === id);
  const slots = useMemo(() => (sessionsQ.data || []).filter((s) => s.hub_challenge_id === id), [sessionsQ.data, id]);
  const qualifiers = slots.filter((s) => s.hub_challenge_stage !== 'final');
  const final = slots.find((s) => s.hub_challenge_stage === 'final');
  const myBooked = useMemo(() => {
    const set = new Set<string>();
    (myQ.data?.bookings || []).forEach((b) => { if (['confirmed', 'attended'].includes(b.status)) set.add(String(b.session_id)); });
    return set;
  }, [myQ.data]);

  const [picked, setPicked] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [answered, setAnswered] = useState<'yes' | 'no' | null>(null);

  if (challengesQ.isLoading || sessionsQ.isLoading) return <SafeAreaView className="flex-1 bg-atp-black items-center justify-center"><ActivityIndicator color={colors.green} /></SafeAreaView>;
  if (!c) return <SafeAreaView className="flex-1 bg-atp-black px-5"><Header title="Challenge" /><Empty title="Challenge not found" body="It may not be open yet." /></SafeAreaView>;

  const mine = c.my_entry;
  const partner = partnerFor(c);
  const needsTeam = c.kind === 'team' && !(mine && mine.team);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['hub30'] }), qc.invalidateQueries({ queryKey: ['bookings'] })]);

  async function register(sessionId: string) {
    setErr(null); setBusy(true);
    try {
      if (needsTeam) {
        if (teamName.trim().length < 2) { setErr('Give your team a name.'); setBusy(false); return; }
        await createHubTeam(c!.id, teamName.trim(), sessionId);
      }
      await createBooking(sessionId);
      setDone(sessionId); setPicked(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      if (e instanceof ApiError && /already have a booking/i.test(msg)) { setDone(sessionId); setPicked(null); await refresh(); }
      else setErr(msg || 'Registration failed — please try again.');
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <Header title={c.name} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View className="flex-row items-start justify-between">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: c.kind === 'team' ? GREEN2 : colors.danger }} className="text-xs uppercase tracking-widest flex-1">{kindLabel(c)}</Text>
          {!!partner && <PartnerLogo partner={partner} height={44} />}
        </View>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase mt-1">{c.name}</Text>
        {!!c.description && <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2 leading-5">{c.description}</Text>}
        <View className="flex-row flex-wrap mt-4">
          {!!c.qualifier_start && <Fact label="Qualifiers" value={`${ymdLabel(c.qualifier_start)} – ${ymdLabel(c.qualifier_end)}`} />}
          {!!c.final_date && <Fact label="Final" value={ymdLabel(c.final_date)} />}
          {c.finals_cut_enabled && <Fact label="Finals cut" value={`Top ${c.finals_cut}${c.kind === 'team' ? (c.finals_cut === 1 ? ' team' : ' teams') : c.split_gender ? ' per category' : ''}`} />}
          {c.charity_enabled && <Fact label="Supports" value={`💚 ${c.charity_name}`} />}
        </View>

        {mine && mine.team && <TeamCard c={c} team={mine.team} />}
        {!!done && (
          <View className="bg-atp-dark rounded-atp border border-atp-green/40 p-4 mt-4 items-center">
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-xl uppercase">✓ You’re registered</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm text-center mt-1">Your QR code is in My bookings — show it at the {c.name} station.</Text>
            <Pressable onPress={() => router.push('/bookings')} className="mt-3 border border-white/20 rounded-atp px-4 py-2.5 active:opacity-70">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">Open my QR code</Text>
            </Pressable>
            {!!partner && <View className="mt-4"><PoweredBy partner={partner} height={32} align="center" /></View>}
          </View>
        )}
        {c.charity_enabled && mine && !mine.donation_choice && !answered && <CharityAsk c={c} onAnswered={setAnswered} />}
        {answered && <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm text-center mt-3">{answered === 'yes' ? `💚 Thank you for supporting ${c.charity_name}!` : 'No problem — have a great challenge!'}</Text>}

        {c.kind === 'team' && needsTeam && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-5 leading-5">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>Team registration: </Text>
            the captain picks a slot below, names the team and gets an invite to share. Teammates join with the invite link or the team code below.
          </Text>
        )}
        {c.kind === 'team' && needsTeam && (
          <View className="bg-atp-dark rounded-atp border border-white/5 p-4 mt-4">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">Joining a team?</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">Open your captain’s invite link, or type the team code from it (e.g. UQIKT4X).</Text>
            <View className="flex-row mt-3 gap-2">
              <TextInput value={joinCode} onChangeText={(v) => setJoinCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="Team code" placeholderTextColor={colors.muted} autoCapitalize="characters"
                style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="flex-1 bg-white/5 border border-white/10 rounded-atp px-3 py-2.5 text-base" />
              <Pressable disabled={joinCode.length < 4} onPress={() => router.push({ pathname: '/hub30x30/join', params: { code: joinCode } })}
                className={`rounded-atp px-4 justify-center ${joinCode.length < 4 ? 'bg-white/10' : 'bg-atp-green'}`}>
                <Text style={{ fontFamily: fontFamily.bodyBold, color: joinCode.length < 4 ? colors.muted : colors.black }} className="text-sm">Join</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mt-6 mb-2">Qualifier slots — one per day</Text>
        {!qualifiers.length ? <Empty title="Qualifier slots open soon" body="They’ll appear here and on atthepark.world." /> : qualifiers.map((s) => {
          const booked = myBooked.has(String(s.id)) || done === s.id;
          const open = picked === s.id;
          return (
            <View key={s.id} className="bg-atp-dark rounded-atp border border-white/5 mb-2 overflow-hidden" style={{ borderLeftWidth: 3, borderLeftColor: colors.danger }}>
              <Pressable disabled={booked} onPress={() => { setPicked(open ? null : s.id); setErr(null); }} className="flex-row items-center px-4 py-3 active:opacity-70">
                <View className="flex-1">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">{hubWhen(s.scheduled_at)}</Text>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">{s.registrations_count || 0}{s.capacity ? ` / ${s.capacity}` : ''} booked · {s.location || 'DIC Amphitheatre'}</Text>
                </View>
                <Text style={{ fontFamily: fontFamily.bodyBold, color: booked ? colors.green : colors.light }} className="text-sm">{booked ? '✓ Booked' : open ? '▴' : 'Register ›'}</Text>
              </Pressable>
              {open && !booked && (
                <View className="px-4 pb-4">
                  {needsTeam && (
                    <>
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm mb-1">Register your team (you’ll be the captain)</Text>
                      <TextInput value={teamName} onChangeText={setTeamName} maxLength={40} placeholder="Team name" placeholderTextColor={colors.muted}
                        style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="bg-white/5 border border-white/10 rounded-atp px-3 py-2.5 text-base mb-2" />
                    </>
                  )}
                  <SessionTerms accepted={terms} onToggle={setTerms} />
                  <Pressable disabled={!terms || busy} onPress={() => register(s.id)} className={`rounded-atp py-3.5 items-center mt-3 ${!terms || busy ? 'bg-white/10' : 'bg-atp-green'}`}>
                    {busy ? <ActivityIndicator color={colors.black} /> : (
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: !terms ? colors.muted : colors.black }} className="text-sm">
                        {needsTeam ? 'Create team & book this slot' : 'Register — book this slot'}
                      </Text>
                    )}
                  </Pressable>
                  {!!err && <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm mt-2">{err}</Text>}
                </View>
              )}
            </View>
          );
        })}
        {!!final && (
          <View className="bg-atp-dark rounded-atp border border-white/5 p-4 mt-3" style={{ borderLeftWidth: 3, borderLeftColor: '#b8892b' }}>
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">🏆 Final · {hubWhen(final.scheduled_at)}</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">For the athletes inside the finals cut — you get there through the qualifiers.</Text>
          </View>
        )}
        <Pressable onPress={() => router.push({ pathname: '/hub30x30', params: { tab: 'results' } })} className="mt-5 items-center py-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">See the leaderboard ›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title }: { title: string }) {
  return (
    <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/hub30x30'))} className="py-2 -ml-2 px-2">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
      </Pressable>
      <Text numberOfLines={1} style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2 flex-1">{title}</Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="w-1/2 mb-3 pr-2">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">{label}</Text>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm mt-0.5">{value}</Text>
    </View>
  );
}
