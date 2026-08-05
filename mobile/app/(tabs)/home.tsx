/**
 * Home tab — landing screen after sign-in.
 *
 * Composition (top → bottom):
 *   1. Compact greeting (small avatar + name + streak)
 *   2. Primary CTAs — BOOK A SESSION / STORE (founder 2026-08-01:
 *      these must be the two most prominent elements on the screen;
 *      the points/sessions/friends stat strip moved to Profile only)
 *   3. "My Next Session" — the member's soonest booking (shared card,
 *      deep-links to /sessions/[id])
 *   4. Device week card + quick actions
 *   5. "Coming up" session discovery rail (pulled from /api/sessions)
 *
 * Pulls endpoints in parallel via React Query so the screen paints in
 * one frame after data lands. Pull-to-refresh re-runs all of them.
 * Auth-store member is the source of truth for the greeting so the
 * screen renders instantly while the freshest data resolves.
 */
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfile, getStreak } from '@/lib/api/members';
import { listSessions, type Session } from '@/lib/api/sessions';
import { useAuthStore } from '@/lib/stores/auth.store';
import { SessionCard } from '@/lib/components/SessionCard';
import { StreakBadge } from '@/lib/components/StreakBadge';
import { Avatar } from '@/lib/components/Avatar';
import { DeviceWeekCard } from '@/lib/components/DeviceWeekCard';
import { MyNextSession } from '@/lib/components/MyNextSession';
import { Icon, type IconName } from '@/lib/components/icons';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function Home() {
  const member = useAuthStore((s) => s.member) as any;
  const qc     = useQueryClient();

  const profileQ = useQuery({ queryKey: ['profile'], queryFn: () => getProfile().then(r => r.member) });
  const streakQ  = useQuery({ queryKey: ['streak'],  queryFn: () => getStreak().then(r => r.streak) });
  const sessionsQ = useQuery({
    queryKey: ['sessions', 'home-upcoming'],
    queryFn:  () => listSessions({ status: 'upcoming', limit: 8 }).then(r => r.sessions),
  });
  const me = profileQ.data || member;

  const refreshing = streakQ.isFetching || sessionsQ.isFetching;
  const onRefresh  = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['streak'] }),
      qc.invalidateQueries({ queryKey: ['my-bookings'] }),
      qc.invalidateQueries({ queryKey: ['sessions'] }),
    ]);
  }, [qc]);

  const sessions = sessionsQ.data || [];
  const name     = member?.first_name || 'Athlete';

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl tintColor={colors.green} refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Greeting — compact (founder 2026-08-01: was too big) */}
        <View className="px-5 pt-4 flex-row items-center gap-3">
          <Pressable onPress={() => router.push('/(tabs)/profile')}>
            <Avatar
              uri={me?.avatar_url}
              firstName={me?.first_name}
              lastName={me?.last_name}
              id={me?.id}
              size={38}
              borderColor={colors.green}
              borderWidth={2}
            />
          </Pressable>
          <View className="flex-1">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px]">
              Welcome back,
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
              className="text-lg uppercase tracking-tight"
            >
              {name}.
            </Text>
          </View>
          <StreakBadge streak={streakQ.data || null} compact />
        </View>

        {/* Primary CTAs — the two things a member most wants to do
            (founder 2026-08-01: big, unmissable, brand lime) */}
        <View className="px-5 mt-5 gap-3">
          <Pressable
            onPress={() => router.push('/(tabs)/sessions')}
            className="bg-atp-green rounded-atp-lg p-5 flex-row items-center justify-between active:opacity-80"
          >
            <View className="flex-1">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.black }} className="text-2xl uppercase tracking-tight">
                Book a session
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: 'rgba(0,0,0,0.65)' }} className="text-xs mt-0.5">
                Pick a day, grab your spot
              </Text>
            </View>
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.black, fontSize: 26 }}>→</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/store')}
            className="bg-atp-green rounded-atp-lg p-5 flex-row items-center justify-between active:opacity-80"
          >
            <View className="flex-1">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.black }} className="text-2xl uppercase tracking-tight">
                Store
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: 'rgba(0,0,0,0.65)' }} className="text-xs mt-0.5">
                Official ATP gear + drops
              </Text>
            </View>
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.black, fontSize: 26 }}>→</Text>
          </Pressable>
        </View>

        {/* My next session — the member's own soonest booking */}
        <View className="px-5 mt-7">
          <MyNextSession />
        </View>

        {/* My device this week — wearable mirror (per founder 2026-06-27) */}
        <DeviceWeekCard />

        {/* Quick actions */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            Quick actions
          </Text>
          <View className="flex-row gap-3">
            <QuickAction label="Find session" icon="location" onPress={() => router.push('/(tabs)/sessions')} />
            <QuickAction label="Challenges"   icon="target"   onPress={() => router.push('/challenges')} />
            <QuickAction label="Leaderboard"  icon="trophy"   onPress={() => router.push('/leaderboard')} />
          </View>
          <View className="flex-row gap-3 mt-3">
            <QuickAction label="Live now"     icon="live"     onPress={() => router.push('/live')} />
            <QuickAction label="Messages"     icon="chat"     onPress={() => router.push('/messages')} />
            <QuickAction label="Stories"      icon="story"    onPress={() => router.push('/blog')} />
          </View>
        </View>

        {/* Ambassador scan & check-in — prominent full-width entry, only
            for ambassadors. The dashboard route lists today's sessions →
            tap → camera scanner. Was previously buried three levels deep
            under Profile → Ambassador tools. */}
        {!!me?.is_ambassador && (
          <View className="px-5 mt-4">
            <Pressable
              onPress={() => router.push('/ambassador')}
              className="bg-atp-green rounded-atp-lg p-4 flex-row items-center justify-between active:opacity-80"
            >
              <View className="flex-1">
                <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.black }} className="text-lg uppercase tracking-tight">
                  Scan & check-in
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: 'rgba(0,0,0,0.65)' }} className="text-xs mt-0.5">
                  Ambassador tools · scan member QR codes at your session
                </Text>
              </View>
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.black, fontSize: 22 }}>→</Text>
            </Pressable>
          </View>
        )}

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
              {sessions.slice(0, 4).map((s: Session) => (
                <SessionCard key={s.id} session={s} compact />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ label, icon, emoji, onPress }: { label: string; icon?: IconName; emoji?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      // Press feel: slight sink + dim reads as a physical button rather
      // than a plain opacity flash.
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
      className="flex-1 bg-atp-dark rounded-atp-lg border border-white/5 p-4 items-center active:opacity-80"
    >
      {icon
        ? <Icon name={icon} size={26} color={colors.green} />
        : <Text className="text-2xl">{emoji}</Text>}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ fontFamily: fontFamily.bodyBold, color: colors.white, letterSpacing: 1.2 }}
        className="text-xs uppercase mt-2 text-center"
      >
        {label}
      </Text>
    </Pressable>
  );
}
