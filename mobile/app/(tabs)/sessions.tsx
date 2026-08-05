/**
 * Sessions tab — calendar-first layout, matching the website's
 * sessions page UX.
 *
 * Composition (top → bottom) — SLIM by design (founder 2026-08-05:
 * "the calendar still takes too much space — the session list is the
 * hero"). The whole control area is 3 thin rows:
 *   1. Header             — page title only, no subtitle.
 *   2. Week strip         — 14 days starting from today, tiny ~40px
 *                            pills (day-of-week micro-label + date
 *                            number + availability dot). Tap to focus
 *                            that day. Today is auto-selected on mount.
 *   3. ONE filter chips row — tribes · cities · activities as small
 *      chips separated by hairline dividers. Tap to select, tap the
 *      active chip again to clear. City/activity options stay DYNAMIC
 *      (founder 2026-08-01): derived from an unfiltered
 *      ['sessions','facets'] query so a city/activity only gets a chip
 *      if at least one upcoming session actually has it. Tribes stay
 *      static (always the 3 tribes).
 *   4. Sessions list      — only sessions for the focused day; each card
 *                            enters with FadeInDown so the day-tap feels
 *                            responsive.
 *
 * All filters live in local state, the query refetches when city / tribe /
 * activity change but NOT when the focused day changes — day filtering is
 * client-side over the already-loaded week of sessions, so day-tapping
 * feels instant.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listSessions, listTribes, type Session } from '@/lib/api/sessions';
import { SessionCard } from '@/lib/components/SessionCard';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { LoadError } from '@/lib/components/LoadError';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Tiny filter chip — deliberately smaller than FilterPills so the
 * whole filter set reads as one slim control row. Tap toggles: tapping
 * the active chip clears its facet (no "All" pills = less noise).
 */
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1 border active:opacity-70 ${active ? 'bg-atp-green border-atp-green' : 'bg-white/5 border-white/10'}`}
    >
      <Text
        style={{ fontFamily: fontFamily.bodyBold, color: active ? colors.black : colors.light, letterSpacing: 1 }}
        className="text-[10px] uppercase"
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildWeek(weeks = 2): Date[] {
  const out: Date[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(d);
  }
  return out;
}

export default function Sessions() {
  const qc = useQueryClient();

  const [cityId,     setCityId]     = useState<string | null>(null);
  const [tribeSlug,  setTribeSlug]  = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [focusedDay, setFocusedDay] = useState<string>(ymd(new Date()));

  const days = useMemo(() => buildWeek(2), []);

  const tribesQ = useQuery({ queryKey: ['tribes'], queryFn: () => listTribes().then(r => r.tribes), staleTime: 1000 * 60 * 30 });

  // Unfiltered upcoming sessions — the facet base. City/activity pills
  // are derived from what's actually on the calendar, not the full
  // catalogs, so members never tap a filter that yields zero sessions.
  const facetsQ = useQuery({
    queryKey: ['sessions', 'facets'],
    queryFn:  () => listSessions({ status: 'upcoming', limit: 200 }).then(r => r.sessions),
    staleTime: 1000 * 60 * 5,
  });

  const sessionsQ = useQuery({
    queryKey: ['sessions', 'calendar', { cityId, tribeSlug, activityId }],
    queryFn:  () => listSessions({
      status:      'upcoming',
      city_id:     cityId     ?? undefined,
      tribe:       tribeSlug  ?? undefined,
      activity_id: activityId ?? undefined,
      limit:       200,
    }).then(r => r.sessions),
  });

  // Group sessions by YYYY-MM-DD so we can both show the per-day count
  // on each pill and render the focused day's list in one pass.
  const byDay = useMemo(() => {
    const map: Record<string, Session[]> = {};
    for (const s of sessionsQ.data || []) {
      if (!s.scheduled_at) continue;
      const k = ymd(new Date(s.scheduled_at));
      (map[k] ||= []).push(s);
    }
    return map;
  }, [sessionsQ.data]);

  const focusedSessions = byDay[focusedDay] || [];

  // If today has zero sessions on first load, auto-jump to the next
  // non-empty day so the user lands on something useful.
  useEffect(() => {
    if (!sessionsQ.data || focusedDay !== ymd(new Date())) return;
    if (byDay[focusedDay]?.length) return;
    const nextWithSessions = days.find((d) => byDay[ymd(d)]?.length);
    if (nextWithSessions) setFocusedDay(ymd(nextWithSessions));
  }, [sessionsQ.data, byDay, days, focusedDay]);

  const tribeOptions = (tribesQ.data || []).map((t: any) => ({ value: String(t.slug), label: t.name }));

  // Unique city/activity options actually present in upcoming sessions.
  const { cityOptions, activityOptions } = useMemo(() => {
    const cities     = new Map<string, string>();
    const activities = new Map<string, string>();
    for (const s of facetsQ.data || []) {
      if (s.city_id != null && s.city_name)         cities.set(String(s.city_id), s.city_name);
      if (s.activity_id != null && s.activity_name) activities.set(String(s.activity_id), s.activity_name);
    }
    const toOptions = (m: Map<string, string>) =>
      [...m.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    return { cityOptions: toOptions(cities), activityOptions: toOptions(activities) };
  }, [facetsQ.data]);

  // If a selected filter value disappears from the facets (e.g. the last
  // session in that city passed), clear it so the list can't get stuck.
  useEffect(() => {
    if (!facetsQ.data) return;
    if (cityId     && !cityOptions.some((o) => o.value === cityId))         setCityId(null);
    if (activityId && !activityOptions.some((o) => o.value === activityId)) setActivityId(null);
  }, [facetsQ.data, cityOptions, activityOptions, cityId, activityId]);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      {/* Header — title only; the list header below already announces
          the focused day + count, so no subtitle here. */}
      <View className="px-5 pt-2 pb-1">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
          Sessions
        </Text>
      </View>

      {/* Week strip — slim single row of ~40px pills. flexGrow:0 pins
          the ScrollView to its content height so it can never expand
          into space meant for the list. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6, gap: 5 }}
      >
        {days.map((d) => {
          const k     = ymd(d);
          const count = byDay[k]?.length || 0;
          const isFocused = k === focusedDay;
          const isToday   = k === ymd(new Date());
          return (
            <Pressable
              key={k}
              onPress={() => setFocusedDay(k)}
              className={`w-10 py-1 rounded-lg items-center active:opacity-70 ${isFocused ? 'bg-atp-green' : 'bg-white/5'}`}
            >
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: isFocused ? colors.black : colors.muted, letterSpacing: 1 }}
                className="text-[9px] uppercase"
              >
                {isToday ? 'Today' : DAY_NAMES[d.getDay()]}
              </Text>
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: isFocused ? colors.black : count > 0 ? colors.white : colors.muted }}
                className="text-sm"
              >
                {d.getDate()}
              </Text>
              {/* Availability dot — replaces the old count badge; always
                  rendered (transparent when empty) so pill heights match. */}
              <View
                className="rounded-full"
                style={{
                  width: 3, height: 3, marginTop: 1, marginBottom: 2,
                  backgroundColor: count > 0 ? (isFocused ? colors.black : colors.green) : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ONE filter chips row — tribes · cities · activities. Hairline
          dividers separate the groups; tap the active chip to clear. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        className="border-b border-white/5"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8, gap: 6, alignItems: 'center' }}
      >
        {tribeOptions.map((o) => (
          <Chip
            key={`t-${o.value}`}
            label={o.label}
            active={tribeSlug === o.value}
            onPress={() => setTribeSlug(tribeSlug === o.value ? null : o.value)}
          />
        ))}
        {cityOptions.length > 0 && <View className="w-px h-3.5 bg-white/10 mx-0.5" />}
        {cityOptions.map((o) => (
          <Chip
            key={`c-${o.value}`}
            label={o.label}
            active={cityId === o.value}
            onPress={() => setCityId(cityId === o.value ? null : o.value)}
          />
        ))}
        {activityOptions.length > 0 && <View className="w-px h-3.5 bg-white/10 mx-0.5" />}
        {activityOptions.map((o) => (
          <Chip
            key={`a-${o.value}`}
            label={o.label}
            active={activityId === o.value}
            onPress={() => setActivityId(activityId === o.value ? null : o.value)}
          />
        ))}
      </ScrollView>

      {/* Sessions list — animated reveal on day change */}
      {sessionsQ.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : sessionsQ.isError ? (
        <View className="flex-1 justify-center px-5">
          <LoadError onRetry={() => sessionsQ.refetch()} message="Couldn't load sessions — check your connection." />
        </View>
      ) : focusedSessions.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase text-center">
            No sessions this day.
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-2 text-center">
            Tap another day, or clear a filter.
          </Text>
        </View>
      ) : (
        <FlatList
          key={focusedDay}              /* force re-mount so FadeInDown fires on day change */
          className="flex-1"
          data={focusedSessions}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.duration(280).delay(index * 40)}
              exiting={FadeOut.duration(120)}
              className="px-5 pb-3"
            >
              <SessionCard session={item} />
            </Animated.View>
          )}
          ListHeaderComponent={
            <View className="px-5 pt-4 pb-2">
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: colors.green, letterSpacing: 1.2 }}
                className="text-xs uppercase"
              >
                {focusedSessions.length} session{focusedSessions.length === 1 ? '' : 's'} on {formatFullDay(focusedDay)}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              tintColor={colors.green}
              refreshing={sessionsQ.isFetching && !sessionsQ.isLoading}
              onRefresh={() => qc.invalidateQueries({ queryKey: ['sessions'] })}
            />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </SafeAreaView>
  );
}

function formatFullDay(ymdStr: string): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(y!, (m! - 1), d!);
  return dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}
