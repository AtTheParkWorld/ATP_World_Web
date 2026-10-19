/**
 * Join a 30x30 challenge team (founder 2026-10-19). Reached from the
 * captain's invite link (atthepark.world/30x30-hub?team=CODE → app via
 * +native-intent) or by typing the team code in Hub → Challenges. Joins
 * the team, then books the team's slot — same as the website.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBooking } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { getHubTeam, joinHubTeam, hubWhen } from '@/lib/api/hubChallenges';
import { SessionTerms } from '@/lib/components/SessionTerms';
import { HubEmpty, CharityAsk, useHubData } from '@/lib/components/Hub30';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function JoinHubTeam() {
  const { code: raw } = useLocalSearchParams<{ code?: string }>();
  const code = String(raw || '').trim().toUpperCase();
  const qc = useQueryClient();
  const { challengesQ } = useHubData();
  const teamQ = useQuery({ queryKey: ['hub30', 'team', code], queryFn: () => getHubTeam(code), enabled: code.length >= 4, retry: false });
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [answered, setAnswered] = useState<'yes' | 'no' | null>(null);

  const t = teamQ.data?.team;
  const mine = teamQ.data?.mine;
  const challenge = (challengesQ.data || []).find((c) => t && c.id === t.challenge_id);

  async function join() {
    if (!t) return;
    setErr(null); setBusy(true);
    try {
      await joinHubTeam(code);
      if (t.slot_session_id) {
        try { await createBooking(t.slot_session_id); }
        catch (e) { if (!(e instanceof ApiError && /already have a booking/i.test(e.message))) throw e; }
      }
      setJoined(true);
      await Promise.all([qc.invalidateQueries({ queryKey: ['hub30'] }), qc.invalidateQueries({ queryKey: ['bookings'] })]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message || 'Couldn’t join the team.');
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/hub30x30'))} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">Join a team</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {teamQ.isLoading ? <ActivityIndicator color={colors.green} /> : !t ? (
          <HubEmpty title="This team link isn’t valid" body={(teamQ.error as Error)?.message || 'Check the code with your captain.'} />
        ) : (
          <>
            <Text style={{ fontFamily: fontFamily.bodyBold, color: '#22c55e' }} className="text-xs uppercase tracking-widest">{t.challenge_name}</Text>
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase mt-1">{t.name}</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2">
              Captain: {t.captain} · {t.members} of {t.team_max} members{t.slot_at ? `\nTeam slot: ${hubWhen(t.slot_at)}` : ''}
            </Text>

            {joined || mine?.in_this_team ? (
              <View className="bg-atp-dark rounded-atp border border-atp-green/40 p-4 mt-5 items-center">
                <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-xl uppercase">✓ You’re in {t.name}</Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm text-center mt-1">
                  {t.slot_session_id ? 'You’re booked on the team slot — your QR code is in My bookings.' : 'Your captain will pick the slot.'}
                </Text>
                <View className="flex-row gap-2 mt-3">
                  <Pressable onPress={() => router.push('/bookings')} className="border border-white/20 rounded-atp px-4 py-2.5 active:opacity-70">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">My QR code</Text>
                  </Pressable>
                  <Pressable onPress={() => router.push(`/hub30x30/challenge/${t.challenge_id}`)} className="border border-white/20 rounded-atp px-4 py-2.5 active:opacity-70">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">Open the challenge</Text>
                  </Pressable>
                </View>
              </View>
            ) : mine?.in_other_team ? (
              <HubEmpty title="You’re already in another team" body="You can only be in one team per challenge." />
            ) : t.full ? (
              <HubEmpty title="This team is full" body={`${t.name} already has ${t.team_max} members.`} />
            ) : (
              <View className="mt-5">
                <SessionTerms accepted={terms} onToggle={setTerms} />
                <Pressable disabled={!terms || busy} onPress={join} className={`rounded-atp py-3.5 items-center mt-3 ${!terms || busy ? 'bg-white/10' : 'bg-atp-green'}`}>
                  {busy ? <ActivityIndicator color={colors.black} /> : (
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: !terms ? colors.muted : colors.black }} className="text-sm">
                      Join team{t.slot_session_id ? ' & book the team slot' : ''}
                    </Text>
                  )}
                </Pressable>
                {!!err && <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm mt-2">{err}</Text>}
              </View>
            )}
            {(joined || mine?.in_this_team) && challenge?.charity_enabled && !challenge.my_entry?.donation_choice && !answered && <CharityAsk c={challenge} onAnswered={setAnswered} />}
            {answered && <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm text-center mt-3">{answered === 'yes' ? `💚 Thank you for supporting ${challenge?.charity_name}!` : 'No problem — have a great challenge!'}</Text>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
