/**
 * Home tab — landing screen after sign-in.
 *
 * Composition (top → bottom):
 *   1. Greeting + streak badge
 *   2. Points + sessions stat strip
 *   3. Next upcoming booking card (deep-links to /sessions/[id])
 *   4. "Today" + "This weekend" session rails (pulled from /api/sessions)
 *   5. Quick actions — QR / Rewards / Find a session
 *
 * Pulls four endpoints in parallel via React Query so the screen
 * paints in one frame after data lands. Pull-to-refresh re-runs all
 * four. Auth-store member is the source of truth for the greeting so
 * the screen renders instantly while the freshest data resolves.
 */
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStreak, getStats } from '@/lib/api/members';
import { listMyBookings } from '@/lib/api/bookings';
import { listSessions } from '@/lib/api/sessions';
import { useAuthStore } from '@/lib/stores/auth.store';
import { SessionCard } from '@/lib/components/SessionCard';
import { StreakBadge } from '@/lib/components/StreakBadge';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function Home() {
  const member = useAuthStore((s) => s.member);
  const qc     = useQueryClient();

  const streakQ   = useQuery({ queryKey: ['streak'],    queryFn: () => getStreak().then(r => r.streak) });
  const statsQ    = useQuery({ queryKey: ['stats'],     queryFn: () => getStats().then(r => r.stats) });
  const bookingsQ = useQuery({ queryKey: ['my-bookings'], queryFn: () => listMyBookings().then(r => r.bookings) });
  const sessionsQ = useQuery({
    queryKey: ['sessions', 'home-upcoming'],
    queryFn:  () => listSessions({ status: 'upcoming', limit: 8 }).then(r => r.sessions),
  });

  const refreshing = streakQ.isFetching || statsQ.isFetching || bookingsQ.isFetching || sessionsQ.isFetching;
  const onRefresh  = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['streak'] }),
      qc.invalidateQueries({ queryKey: ['stats'] }),
      qc.invalidateQueries({ queryKey: ['my-bookings'] }),
      qc.invalidateQueries({ queryKey: ['sessions'] }),
    ]);
  }, [qc]);

  const upcoming = (bookingsQ.data || []).filter(
    (b) => b.status !== 'cancelled' && b.scheduled_at && new Date(b.scheduled_at).getTime() > Date.now()
  );
  const nextBooking = upcoming[0] || null;
  const sessions    = sessionsQ.data || [];
  const name        = member?.first_name || 'Athlete';

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl tintColor={colors.green} refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Greeting */}
        <View className="px-5 pt-4">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
            Welcome back,
          </Text>
          <Text
            style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
            className="text-4xl uppercase tracking-tight mt-0.5"
          >
            {name}.
          </Text>
          <View className="mt-3">
            <StreakBadge streak={streakQ.data || null} />
          </View>
        </View>

        {/* Stat strip */}
        <View className="px-5 mt-5">
          <View className="flex-row gap-3">
            <StatTile
              label="Points"
              value={statsQ.data ? statsQ.data.current_balance.toLocaleString() : '—'}
            />
            <StatTile
              label="Sessions"
              value={statsQ.data ? String(statsQ.data.total_sessions) : '—'}
            />
            <StatTile
              label="Friends"
              value={statsQ.data ? String(statsQ.data.friends_count) : '—'}
            />
          </View>
        </View>

        {/* Next booking */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            Next session
          </Text>
          {bookingsQ.isLoading ? (
            <ActivityIndicator color={colors.green} />
          ) : nextBooking ? (
            <Pressable
              onPress={() => router.push(`/sessions/${nextBooking.session_id}`)}
              className="bg-atp-dark rounded-atp-lg border border-white/5 p-5 active:opacity-70"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-1">
                {nextBooking.tribe_name || nextBooking.city_name || 'Booked'}
              </Text>
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
                {nextBooking.session_name}
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2">
                {nextBooking.scheduled_at && new Date(nextBooking.scheduled_at).toLocaleString()}
              </Text>
              {!!nextBooking.location && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
                  📍 {nextBooking.location}
                </Text>
              )}
              {!!nextBooking.qr_token && (
                <View className="mt-3 self-start bg-atp-green/15 border border-atp-green/40 px-3 py-1.5 rounded-full">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                    Tap to show QR
                  </Text>
                </View>
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push('/(tabs)/sessions')}
              className="bg-atp-dark rounded-atp-lg border border-dashed border-white/10 p-5 active:opacity-70"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm uppercase tracking-widest">
                Nothing booked yet
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
                Browse today's free sessions →
              </Text>
            </Pressable>
          )}
        </View>

        {/* Quick actions */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            Quick actions
          </Text>
          <View className="flex-row gap-3">
            <QuickAction label="Find session" emoji="📍" onPress={() => router.push('/(tabs)/sessions')} />
            <QuickAction label="Challenges"   emoji="🎯" onPress={() => router.push('/challenges')} />
            <QuickAction label="Leaderboard"  emoji="🏆" onPress={() => router.push('/leaderboard')} />
          </View>
          <View className="flex-row gap-3 mt-3">
            <QuickAction label="Messages"     emoji="💬" onPress={() => router.push('/messages')} />
            <QuickAction label="Stories"      emoji="📖" onPress={() => router.push('/blog')} />
            <QuickAction label="Rewards"      emoji="🎁" onPress={() => router.push('/(tabs)/rewards')} />
          </View>
        </View>

        {/* Upcoming session rail */}
        <View className="mt-8">
          <View className="px-5 flex-row items-center justify-between mb-3">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
              Coming up
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/sessions')}>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                See all
              </Text>
            </Pressable>
          </View>
          {sessionsQ.isLoading ? (
            <View className="px-5"><ActivityIndicator color={colors.green} /></View>
          ) : sessions.length === 0 ? (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="px-5 text-sm">
              No upcoming sessions match your filters yet.
            </Text>
          ) : (
            <View className="px-5 gap-3">
              {sessions.slice(0, 4).map((s) => (
                <SessionCard key={s.id} session={s} compact />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 bg-atp-dark rounded-atp-lg border border-white/5 p-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
        {label}
      </Text>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl mt-1">
        {value}
      </Text>
    </View>
  );
}

function QuickAction({ label, emoji, onPress }: { label: string; emoji: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 bg-atp-dark rounded-atp-lg border border-white/5 p-4 items-center active:opacity-70"
    >
      <Text className="text-2xl">{emoji}</Text>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest mt-2">
        {label}
      </Text>
    </Pressable>
  );
}
