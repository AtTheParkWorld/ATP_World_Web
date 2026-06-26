/**
 * Sessions tab — calendar-first layout, matching the website's
 * sessions page UX.
 *
 * Composition (top → bottom):
 *   1. Tribe filter row  — All / Better / Faster / Stronger pills
 *   2. Week strip         — 14 days starting from today, horizontal pills.
 *                            Day name + date number + small count badge.
 *                            Tap to focus that day. Today is auto-selected
 *                            on mount.
 *   3. City + Activity filter row (horizontal pills)
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
import { listSessions, listCities, listTribes, listActivities, type Session } from '@/lib/api/sessions';
import { SessionCard } from '@/lib/components/SessionCard';
import { FilterPills } from '@/lib/components/FilterPills';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

  const citiesQ     = useQuery({ queryKey: ['cities'],     queryFn: () => listCities().then(r => r.cities),    staleTime: 1000 * 60 * 30 });
  const tribesQ     = useQuery({ queryKey: ['tribes'],     queryFn: () => listTribes().then(r => r.tribes),    staleTime: 1000 * 60 * 30 });
  const activitiesQ = useQuery({ queryKey: ['activities'], queryFn: () => listActivities().then(r => r.activities), staleTime: 1000 * 60 * 30 });

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

  const cityOptions     = (citiesQ.data     || []).map((c: any) => ({ value: String(c.id),   label: c.name }));
  const tribeOptions    = (tribesQ.data     || []).map((t: any) => ({ value: String(t.slug), label: t.name }));
  const activityOptions = (activitiesQ.data || []).map((a: any) => ({ value: String(a.id),   label: a.name }));

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      {/* Header */}
      <View className="px-5 pt-3 pb-3 border-b border-white/5">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight">
          Sessions
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-1">
          {sessionsQ.data?.length || 0} upcoming · pick a day
        </Text>
      </View>

      {/* Tribe filter row (mirrors the website's primary filter bar) */}
      <View className="px-2.5 pt-3">
        <FilterPills
          options={tribeOptions}
          value={tribeSlug}
          onChange={(v) => setTribeSlug(v as string | null)}
          allLabel="All tribes"
        />
      </View>

      {/* Week strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 8 }}
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
              className={`px-3 py-2.5 rounded-atp-lg border min-w-[58px] items-center active:opacity-70 ${isFocused ? 'bg-atp-green border-atp-green' : count > 0 ? 'bg-atp-dark border-white/10' : 'bg-atp-dark border-white/5'}`}
            >
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: isFocused ? colors.black : colors.muted, letterSpacing: 1 }}
                className="text-[10px] uppercase"
              >
                {isToday ? 'Today' : DAY_NAMES[d.getDay()]}
              </Text>
              <Text
                style={{ fontFamily: fontFamily.displayBlack, color: isFocused ? colors.black : count > 0 ? colors.white : colors.muted }}
                className="text-xl mt-0.5"
              >
                {d.getDate()}
              </Text>
              {count > 0 && (
                <View
                  className="mt-1 px-1.5 rounded-full"
                  style={{ backgroundColor: isFocused ? 'rgba(0,0,0,0.18)' : 'rgba(168,255,0,0.18)' }}
                >
                  <Text
                    style={{ fontFamily: fontFamily.bodyBold, color: isFocused ? colors.black : colors.green }}
                    className="text-[10px]"
                  >
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Secondary filters (city + activity) */}
      <View className="border-b border-white/5 pb-3">
        <View className="px-2.5 pb-1">
          <FilterPills
            options={cityOptions}
            value={cityId}
            onChange={(v) => setCityId(v as string | null)}
            allLabel="All cities"
          />
        </View>
        <View className="px-2.5 pt-1">
          <FilterPills
            options={activityOptions}
            value={activityId}
            onChange={(v) => setActivityId(v as string | null)}
            allLabel="All activities"
          />
        </View>
      </View>

      {/* Sessions list — animated reveal on day change */}
      {sessionsQ.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.green} size="large" />
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
