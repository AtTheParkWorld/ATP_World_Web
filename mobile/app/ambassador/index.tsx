/**
 * Ambassador dashboard — lists the sessions this ambassador is
 * assigned to. Tap → attendance roster + scanner.
 *
 * Visibility: only members with is_ambassador=true ever land here.
 * The Profile screen guards the entry point.
 */
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listSessions, type Session } from '@/lib/api/sessions';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { dayHeader, timeShort } from '@/lib/utils/date';

export default function AmbassadorIndex() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;

  // For the MVP, ambassadors see ALL upcoming sessions — the assignment
  // table is admin-managed, and most ambassadors scan multiple sessions
  // a day. A future filter "only mine" can land later via a backend
  // /api/sessions?ambassador_id=me parameter.
  const q = useQuery({
    queryKey: ['amb-sessions'],
    queryFn:  () => listSessions({ status: 'upcoming', limit: 50 }).then(r => r.sessions),
  });

  const sessions = q.data || [];
  // Bucket by today / upcoming
  const { today, upcoming } = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return {
      today:    sessions.filter((s) => s.scheduled_at.slice(0, 10) === todayStr),
      upcoming: sessions.filter((s) => s.scheduled_at.slice(0, 10) >  todayStr),
    };
  }, [sessions]);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Ambassador
        </Text>
      </View>

      <FlatList
        data={[...today, ...upcoming]}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={
          <View className="px-5 pt-4 pb-2">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              Welcome back, {me?.first_name}. Scan member QR codes at the start of every session.
            </Text>
            <View className="bg-atp-green/10 border border-atp-green/40 rounded-atp p-3 mt-3">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-1">
                Today
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-sm">
                {today.length} session{today.length === 1 ? '' : 's'} to scan
              </Text>
            </View>
            {today.length > 0 && (
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mt-5 mb-1">
                Today
              </Text>
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const todayStr = new Date().toISOString().slice(0, 10);
          const isToday  = item.scheduled_at.slice(0, 10) === todayStr;
          const showUpcomingHeader = !isToday && index === today.length;
          return (
            <View>
              {showUpcomingHeader && (
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="px-5 text-xs uppercase tracking-widest mt-4 mb-1">
                  Upcoming
                </Text>
              )}
              <AmbSessionCard session={item} />
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            {q.isLoading
              ? <ActivityIndicator color={colors.green} />
              : <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
                  No upcoming sessions to scan. Quiet day.
                </Text>}
          </View>
        }
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['amb-sessions'] })}
          />
        }
        contentContainerStyle={{ paddingBottom: 60 }}
      />
    </SafeAreaView>
  );
}

function AmbSessionCard({ session }: { session: Session }) {
  const tColor = tribeColor(session.tribe_slug);
  return (
    <Pressable
      onPress={() => router.push(`/ambassador/scan/${session.id}`)}
      className="mx-5 mb-2 bg-atp-dark border border-white/5 rounded-atp p-4 active:opacity-70"
      style={{ borderLeftWidth: 4, borderLeftColor: tColor }}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          {!!session.tribe_name && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: tColor }} className="text-xs uppercase tracking-widest">
              {session.tribe_name}
            </Text>
          )}
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase tracking-tight mt-0.5">
            {session.name}
          </Text>
        </View>
        <View className="items-end">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
            {timeShort(session.scheduled_at)}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
            {dayHeader(session.scheduled_at)}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center gap-3 mt-2">
        {!!session.city_name && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
            📍 {session.city_name}
          </Text>
        )}
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
          {session.registrations_count} booked{session.capacity ? ` / ${session.capacity}` : ''}
        </Text>
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest ml-auto">
          Scan →
        </Text>
      </View>
    </Pressable>
  );
}
