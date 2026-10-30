/**
 * DIC 30x30 Fitness Hub (founder 2026-10-19: "a landing page version of
 * what we have online … same functionalities, registration access as via
 * website"). The app twin of atthepark.world/30x30-hub:
 *   - Schedule:   the '30x30 Hub' sessions by week + activity → the normal
 *                 session screen books them (same booking + QR)
 *   - Challenges: the 30x30 Challenge Series → register / team / charity
 *   - Results:    leaderboards with the finals cut
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Session } from '@/lib/api/sessions';
import {
  getHubLeaderboard, kindLabel, formatResult, hubDay, hubDayLabel, hubTime, ymdLabel, weekOf,
  HUB_WEEKS, type HubChallenge,
} from '@/lib/api/hubChallenges';
import { WEB_BASE } from '@/lib/api/client';
import { SegmentedControl } from '@/lib/components/SegmentedControl';
import { useHubData, HubEmpty as Empty, HubParking } from '@/lib/components/Hub30';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { partnerFor, PartnerLogo, HubPartners } from '@/lib/partners';

type Tab = 'schedule' | 'challenges' | 'results';
const PINK = '#e8458b';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className={`rounded-full px-3.5 py-2 border mr-2 mb-2 ${active ? 'bg-atp-green border-atp-green' : 'bg-white/5 border-white/10'}`}>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: active ? colors.black : colors.light }} className="text-xs">{label}</Text>
    </Pressable>
  );
}

// Activity menu (founder 2026-10-21): one burger button instead of a wall
// of chips; the activities open underneath and close on a pick.
function ActivityMenu({ acts, act, setAct }: { acts: [string, string][]; act: string; setAct: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = act === 'all' ? 'All activities' : acts.find(([k]) => k === act)?.[1] ?? 'All activities';
  const options: [string, string][] = [['all', 'All activities'], ...acts];
  return (
    <View className="mt-1">
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        className="flex-row items-center bg-atp-dark border border-white/10 rounded-atp px-4 py-3 active:opacity-80">
        <View style={{ width: 18, gap: 4 }} className="mr-3">
          {[0, 1, 2].map((i) => <View key={i} style={{ height: 2, borderRadius: 2, backgroundColor: colors.white }} />)}
        </View>
        <View className="flex-1">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">Activity</Text>
          <Text numberOfLines={1} style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm mt-0.5">{label}</Text>
        </View>
        {/* chevron */}
        <View style={{ width: 9, height: 9, borderRightWidth: 2, borderBottomWidth: 2, borderColor: colors.light, marginRight: 4, marginTop: open ? 5 : -5, transform: [{ rotate: open ? '-135deg' : '45deg' }] }} />
      </Pressable>
      {open && (
        <View className="bg-atp-dark border border-white/10 rounded-atp mt-2 p-1.5 flex-row flex-wrap">
          {options.map(([k, l]) => (
            <Pressable key={k} onPress={() => { setAct(k); setOpen(false); }} style={{ width: '50%' }} className="p-0.5 active:opacity-70">
              <View className={`rounded-md px-3 py-2.5 ${act === k ? 'bg-atp-green' : ''}`}>
                <Text numberOfLines={1} style={{ fontFamily: fontFamily.bodyBold, color: act === k ? colors.black : colors.light }} className="text-xs">{l}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export default function Hub30Screen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'challenges' || params.tab === 'results' ? params.tab : 'schedule');
  const qc = useQueryClient();
  const { sessionsQ, challengesQ } = useHubData();

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">30x30 Fitness Hub</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl tintColor={colors.green} refreshing={(sessionsQ.isFetching || challengesQ.isFetching) && !sessionsQ.isLoading}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['hub30'] })} />}
      >
        <View className="mx-5 mt-4 rounded-atp-lg overflow-hidden border border-white/10">
          <Image source={{ uri: `${WEB_BASE}/img/30x30/dic-campus.jpg` }} style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.dark2 }} resizeMode="cover" />
          <View className="p-4 bg-atp-dark">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">Dubai Fitness Challenge</Text>
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase mt-1">Dubai Internet City 30x30 Fitness Hub</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">31 Oct – 29 Nov 2026 · DIC Amphitheatre · Free</Text>
            <View className="self-start mt-3 rounded-md px-2.5 py-1.5" style={{ backgroundColor: PINK }}>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">Kick-off: the Pink Run · Sat 31 Oct, morning</Text>
            </View>
          </View>
        </View>

        <View className="px-5 mt-4">
          <HubParking />
        </View>

        <View className="px-5 mt-5">
          <SegmentedControl<Tab> value={tab} onChange={setTab}
            options={[{ value: 'schedule', label: 'Schedule' }, { value: 'challenges', label: 'Challenges' }, { value: 'results', label: 'Results' }]} />
        </View>

        {tab === 'schedule' && <ScheduleTab sessions={sessionsQ.data} loading={sessionsQ.isLoading} />}
        {tab === 'challenges' && <ChallengesTab challenges={challengesQ.data} sessions={sessionsQ.data} loading={challengesQ.isLoading} />}
        {tab === 'results' && <ResultsTab challenges={challengesQ.data} loading={challengesQ.isLoading} />}

        {/* Partners — on every tab, like the landing page's section */}
        <View className="px-5 mt-10">
          <HubPartners />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Schedule: the '30x30 Hub' sessions ─────────────────────────────
function ScheduleTab({ sessions, loading }: { sessions?: Session[]; loading: boolean }) {
  const hub = useMemo(() => (sessions || []).filter((s: any) => s.session_category === '30x30_hub' && s.scheduled_at)
    .map((s) => ({ s, day: hubDay(s.scheduled_at!) })).filter((x) => x.day >= 1 && x.day <= 30), [sessions]);
  const acts = useMemo(() => {
    const m = new Map<string, string>();
    hub.forEach(({ s }: any) => { if (s.activity_slug || s.activity_id) m.set(String(s.activity_slug || s.activity_id), `${s.activity_icon ? s.activity_icon + ' ' : ''}${s.activity_name || 'Session'}`); });
    return [...m.entries()].sort((a, b) => a[1].replace(/^\W+\s/, '').localeCompare(b[1].replace(/^\W+\s/, '')));
  }, [hub]);
  const today = hubDay(new Date().toISOString());
  const [week, setWeek] = useState<number>(() => (today >= 1 && today <= 30 ? weekOf(today) : 0));
  const [act, setAct] = useState<string>('all');
  const w = HUB_WEEKS[week] ?? HUB_WEEKS[0]!;
  const items = hub.filter(({ s, day }: any) => day >= w[0] && day <= w[1] && (act === 'all' || String(s.activity_slug || s.activity_id) === act));
  const days: number[] = []; for (let d = w[0]; d <= w[1]; d++) days.push(d);

  if (loading) return <View className="pt-10 items-center"><ActivityIndicator color={colors.green} /></View>;
  return (
    <View className="px-5 mt-5">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-1">
        {HUB_WEEKS.map((_, i) => <Chip key={i} label={`Week ${i + 1}`} active={i === week} onPress={() => setWeek(i)} />)}
      </ScrollView>
      {acts.length > 1 && <ActivityMenu acts={acts} act={act} setAct={setAct} />}
      {!hub.length ? (
        <Empty title="30x30 sessions are coming soon" body="The hub opens on the morning of Saturday 31 October with the Pink Run. Sessions open for booking here very soon." />
      ) : !items.length ? (
        <Empty title="No sessions this week" body={act === 'all' ? 'Try another week.' : 'Try another week or activity.'} />
      ) : days.map((d) => {
        const list = items.filter((x) => x.day === d).sort((a, b) => (a.s.scheduled_at! < b.s.scheduled_at! ? -1 : 1));
        if (!list.length) return null;
        return (
          <View key={d} className="mt-4">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">{hubDayLabel(d)}</Text>
            {list.map(({ s }: any) => (
              <Pressable key={s.id} onPress={() => router.push(`/sessions/${s.id}`)} className="flex-row items-center bg-atp-dark rounded-atp border border-white/5 px-4 py-3 mb-2 active:opacity-70">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green, width: 74 }} className="text-sm">{hubTime(s.scheduled_at)}</Text>
                <View className="flex-1">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">{s.name}</Text>
                  {!!s.activity_name && <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">{s.activity_name}</Text>}
                </View>
                {!!partnerFor(s) && <View className="mr-3"><PartnerLogo partner={partnerFor(s)!} kind="vector" height={12} link={false} /></View>}
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.light }} className="text-base">›</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}

// ── Challenges: the 30x30 Challenge Series ─────────────────────────
function ChallengesTab({ challenges, sessions, loading }: { challenges?: HubChallenge[]; sessions?: Session[]; loading: boolean }) {
  if (loading) return <View className="pt-10 items-center"><ActivityIndicator color={colors.green} /></View>;
  const list = challenges || [];
  const slotsOf = (id: string) => (sessions || []).filter((s: any) => s.session_category === '30x30_challenge' && s.hub_challenge_id === id && s.hub_challenge_stage !== 'final').length;
  return (
    <View className="px-5 mt-5">
      <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm leading-5 mb-4">
        Individual and team challenges, all free. Book a qualifier slot — one per day; every attempt counts and your best result ranks. The top athletes and teams make the final.
      </Text>
      {!list.length ? <Empty title="The 30x30 Challenge Series is coming soon" body="Registration opens here and on atthepark.world." /> : list.map((c) => {
        const mine = c.my_entry;
        const status = mine ? (c.kind === 'team' && mine.team ? `✓ Your team: ${mine.team.name} (${mine.team.members}/${c.team_max})` : '✓ You’re registered') : null;
        const open = slotsOf(c.id);
        return (
          <Pressable key={c.id} onPress={() => router.push(`/hub30x30/challenge/${c.id}`)} className="bg-atp-dark rounded-atp-lg border border-white/5 p-4 mb-3 active:opacity-70"
            style={{ borderTopWidth: 3, borderTopColor: c.kind === 'team' ? '#22c55e' : colors.danger }}>
            <View className="flex-row items-start justify-between">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: c.kind === 'team' ? '#22c55e' : colors.danger }} className="text-xs uppercase tracking-widest flex-1">{kindLabel(c)}</Text>
              {!!partnerFor(c) && <PartnerLogo partner={partnerFor(c)!} height={36} />}
            </View>
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-xl uppercase mt-1">{c.name}</Text>
            {!!c.description && <Text numberOfLines={3} style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1.5 leading-5">{c.description}</Text>}
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-2">
              {c.qualifier_start ? `Qualifiers ${ymdLabel(c.qualifier_start)} – ${ymdLabel(c.qualifier_end)}` : ''}{c.final_date ? ` · Final ${ymdLabel(c.final_date)}` : ''}
              {c.finals_cut_enabled ? ` · Top ${c.finals_cut} qualify` : ''}
            </Text>
            {c.charity_enabled && <Text style={{ fontFamily: fontFamily.bodyBold, color: '#22c55e' }} className="text-xs mt-2">💚 For {c.charity_name}</Text>}
            <View className="flex-row items-center justify-between mt-3">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: status ? colors.green : colors.light }} className="text-xs flex-1">
                {status || (open ? `${open} qualifier slot${open === 1 ? '' : 's'} open` : 'Slots open soon')}
              </Text>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">{mine ? 'Open ›' : c.kind === 'team' ? 'Register a team ›' : 'Book a slot ›'}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Results: leaderboards ──────────────────────────────────────────
function ResultsTab({ challenges, loading }: { challenges?: HubChallenge[]; loading: boolean }) {
  const list = challenges || [];
  const [cid, setCid] = useState<string | null>(null);
  const [stage, setStage] = useState<'qualifier' | 'final'>('qualifier');
  const c = list.find((x) => x.id === cid) || list[0];
  const boardQ = useQuery({
    queryKey: ['hub30', 'board', c && c.id, stage],
    queryFn: () => getHubLeaderboard(c!.id, stage),
    enabled: !!c,
  });
  if (loading) return <View className="pt-10 items-center"><ActivityIndicator color={colors.green} /></View>;
  if (!c) return <View className="px-5"><Empty title="Results appear here" body="Checked and published by the ATP team after each session." /></View>;
  const d = boardQ.data;
  const any = d && d.boards.some((b) => b.rows.length);
  return (
    <View className="px-5 mt-5">
      <View className="flex-row flex-wrap">
        {list.map((x) => <Chip key={x.id} label={x.name} active={x.id === c.id} onPress={() => setCid(x.id)} />)}
      </View>
      <View className="mt-1 mb-3">
        <SegmentedControl<'qualifier' | 'final'> value={stage} onChange={setStage} options={[{ value: 'qualifier', label: 'Qualifiers' }, { value: 'final', label: 'Final' }]} />
      </View>
      {boardQ.isLoading ? <ActivityIndicator color={colors.green} /> : !any ? (
        <Empty title={`No ${stage === 'final' ? 'final' : 'qualifier'} results yet`} body="Results are checked and published by the ATP team after each session." />
      ) : d!.boards.map((b) => {
        let cutShown = false;
        return (
          <View key={b.key} className="bg-atp-dark rounded-atp border border-white/5 mb-3 overflow-hidden">
            <View className="flex-row items-center justify-between px-4 py-2.5 bg-white/5">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">{b.label}</Text>
              {!!partnerFor(c) && <PartnerLogo partner={partnerFor(c)!} kind="vector" height={11} />}
            </View>
            {b.rows.map((r) => {
              const cut = stage === 'qualifier' && d!.finals_cut && !cutShown && r.qualified === false;
              if (cut) cutShown = true;
              return (
                <View key={`${b.key}-${r.rank}`}>
                  {cut && <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-[10px] uppercase tracking-widest text-center py-1.5 bg-red-500/10">Finals cut · top {d!.finals_cut}</Text>}
                  <View className={`flex-row px-4 py-2.5 border-t border-white/5 ${stage === 'qualifier' && r.qualified === true ? 'bg-atp-green/10' : ''}`}>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted, width: 28 }} className="text-sm">{r.rank}</Text>
                    <Text style={{ fontFamily: fontFamily.body, color: r.qualified === false && stage === 'qualifier' ? colors.muted : colors.white }} className="text-sm flex-1">{r.name}</Text>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">{formatResult(r.value, c)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
      {!!any && stage === 'qualifier' && !!d!.finals_cut && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">Highlighted = qualifying for the final. Every attempt counts — the best result ranks.</Text>
      )}
    </View>
  );
}

