/**
 * Sessions tab — browse + filter every upcoming session.
 *
 * UX:
 *   - Sticky filter rail at the top: City, Tribe, Activity.
 *     Each is a horizontal pill row. Tap → re-query with the new filter.
 *   - SectionList groups results by relative day ("Today", "Tomorrow",
 *     "Sat 14 Jun"). Cheap to compute client-side and gives the user a
 *     stronger sense of "what's next" than a flat list.
 *   - Pull-to-refresh re-runs the query.
 *
 * Filter options are fetched ONCE (cities + tribes + activities) — they
 * change so rarely we don't need to revalidate per render.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listSessions, listCities, listTribes, listActivities, type Session } from '@/lib/api/sessions';
import { SessionCard } from '@/lib/components/SessionCard';
import { FilterPills } from '@/lib/components/FilterPills';
import { groupByDay } from '@/lib/utils/date';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function Sessions() {
  const qc = useQueryClient();

  const [cityId,     setCityId]     = useState<number | null>(null);
  const [tribeSlug,  setTribeSlug]  = useState<string | null>(null);
  const [activityId, setActivityId] = useState<number | null>(null);

  const citiesQ     = useQuery({ queryKey: ['cities'],     queryFn: () => listCities().then(r => r.cities),    staleTime: 1000 * 60 * 30 });
  const tribesQ     = useQuery({ queryKey: ['tribes'],     queryFn: () => listTribes().then(r => r.tribes),    staleTime: 1000 * 60 * 30 });
  const activitiesQ = useQuery({ queryKey: ['activities'], queryFn: () => listActivities().then(r => r.activities), staleTime: 1000 * 60 * 30 });

  const sessionsQ = useQuery({
    queryKey: ['sessions', 'browse', { cityId, tribeSlug, activityId }],
    queryFn:  () => listSessions({
      status:      'upcoming',
      city_id:     cityId     ?? undefined,
      tribe:       tribeSlug  ?? undefined,
      activity_id: activityId ?? undefined,
      limit:       100,
    }).then(r => r.sessions),
  });

  const sections = useMemo(
    () => groupByDay<Session>(sessionsQ.data || []),
    [sessionsQ.data]
  );

  const cityOptions     = (citiesQ.data     || []).map((c) => ({ value: c.id,   label: c.name }));
  const tribeOptions    = (tribesQ.data     || []).map((t) => ({ value: t.slug, label: t.name }));
  const activityOptions = (activitiesQ.data || []).map((a) => ({ value: a.id,   label: a.name }));

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-3 pb-3 border-b border-white/5">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight">
          Sessions
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-1">
          {sessionsQ.data?.length || 0} upcoming · pick a filter to narrow
        </Text>
      </View>

      <View className="pt-3 gap-2.5 pb-3 border-b border-white/5">
        <View className="px-2.5">
          <FilterPills options={cityOptions}     value={cityId}     onChange={setCityId}     allLabel="All cities" />
        </View>
        <View className="px-2.5">
          <FilterPills options={tribeOptions}    value={tribeSlug}  onChange={setTribeSlug}  allLabel="All tribes" />
        </View>
        <View className="px-2.5">
          <FilterPills options={activityOptions} value={activityId} onChange={setActivityId} allLabel="All activities" />
        </View>
      </View>

      {sessionsQ.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : sections.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase text-center">
            No sessions match.
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-2 text-center">
            Try clearing a filter, or check back later — coaches add new ones every day.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          renderSectionHeader={({ section }) => (
            <View className="bg-atp-black pt-5 pb-2 px-5">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-base uppercase tracking-tight">
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View className="px-5 pb-3">
              <SessionCard session={item} />
            </View>
          )}
          stickySectionHeadersEnabled
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
