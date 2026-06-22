/**
 * Coach dashboard — entry hub. Surfaces:
 *  - Unread visitor message count (red badge) → /coach/threads
 *  - Wallet balance + pending payouts → /coach/wallet
 *  - Quick links to upcoming + past sessions (reuses /sessions/[id]
 *    with a coach-context query param)
 *  - Public profile preview → /coaches/<my-id>
 */
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyCoachThreads, getMyWallet, listMyOfferings } from '@/lib/api/coach';
import { listSessions } from '@/lib/api/sessions';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function CoachIndex() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const coachId = String(me?.id || '');

  const threadsQ = useQuery({
    queryKey: ['coach-threads', coachId],
    queryFn:  () => listMyCoachThreads(coachId),
    enabled:  !!coachId,
    refetchInterval: 30_000,
  });
  const walletQ = useQuery({
    queryKey: ['coach-wallet'],
    queryFn:  () => getMyWallet(),
    enabled:  !!coachId,
  });
  const offeringsQ = useQuery({
    queryKey: ['coach-offerings'],
    queryFn:  () => listMyOfferings().then(r => r.offerings),
    enabled:  !!coachId,
  });
  // Coach's upcoming sessions — backend filter is by coach_id which the
  // list endpoint accepts directly via city/activity not coach; we
  // fetch all upcoming and filter client-side. Small list, fine.
  const sessionsQ = useQuery({
    queryKey: ['sessions', 'upcoming'],
    queryFn:  () => listSessions({ status: 'upcoming', limit: 100 }).then(r => r.sessions),
  });
  const mySessions = (sessionsQ.data || []).filter((s) => s.coach_id === coachId);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Coach
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={threadsQ.isFetching || walletQ.isFetching || sessionsQ.isFetching}
            onRefresh={async () => {
              await Promise.all([
                qc.invalidateQueries({ queryKey: ['coach-threads'] }),
                qc.invalidateQueries({ queryKey: ['coach-wallet'] }),
                qc.invalidateQueries({ queryKey: ['coach-offerings'] }),
                qc.invalidateQueries({ queryKey: ['sessions'] }),
              ]);
            }}
          />
        }
      >
        {/* Greeting */}
        <View className="px-5 pt-4">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
            Welcome back,
          </Text>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight mt-1">
            Coach {me?.first_name}.
          </Text>
        </View>

        {/* Stat strip */}
        <View className="px-5 mt-5 flex-row gap-3">
          <StatTile
            label="Unread DMs"
            value={String(threadsQ.data?.unread_messages ?? 0)}
            accent={threadsQ.data?.unread_messages ? colors.danger : colors.muted}
          />
          <StatTile
            label="Wallet (AED)"
            value={walletQ.data ? walletQ.data.balance_aed.toLocaleString() : '—'}
            accent={colors.green}
          />
          <StatTile
            label="Upcoming"
            value={String(mySessions.length)}
            accent={colors.white}
          />
        </View>

        {/* Quick actions */}
        <View className="px-5 mt-7 gap-2">
          <LinkRow
            label="Inquiries"
            emoji="📨"
            badge={Number(threadsQ.data?.unread_threads ?? 0)}
            onPress={() => router.push('/coach/threads')}
          />
          <LinkRow
            label="Wallet + payouts"
            emoji="💰"
            onPress={() => router.push('/coach/wallet')}
          />
          <LinkRow
            label="My offerings"
            emoji="📋"
            subtitle={offeringsQ.data ? `${offeringsQ.data.length} active` : undefined}
            onPress={() => router.push('/coach/offerings')}
          />
          <LinkRow
            label="My public profile"
            emoji="👤"
            onPress={() => router.push(`/coaches/${coachId}`)}
          />
        </View>

        {/* Upcoming sessions */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            Your upcoming sessions
          </Text>
          {sessionsQ.isLoading ? (
            <ActivityIndicator color={colors.green} />
          ) : mySessions.length === 0 ? (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              No sessions scheduled. The admin assigns sessions in the CMS.
            </Text>
          ) : (
            mySessions.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => router.push(`/sessions/${s.id}`)}
                className="bg-atp-dark border border-white/5 rounded-atp p-3 mb-2 active:opacity-70"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                  {s.name}
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                  {new Date(s.scheduled_at).toLocaleString()} · {s.registrations_count}{s.capacity ? `/${s.capacity}` : ''} booked
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View className="flex-1 bg-atp-dark rounded-atp-lg border border-white/5 p-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
        {label}
      </Text>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: accent }} className="text-2xl mt-1">
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ label, emoji, subtitle, badge, onPress }: { label: string; emoji: string; subtitle?: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-atp-dark border border-white/5 rounded-atp px-4 py-3.5 active:opacity-70"
    >
      <Text style={{ fontSize: 20, marginRight: 12 }}>{emoji}</Text>
      <View className="flex-1">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
          {label}
        </Text>
        {!!subtitle && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
            {subtitle}
          </Text>
        )}
      </View>
      {badge && badge > 0 ? (
        <View className="bg-atp-red rounded-full min-w-[22px] h-[22px] items-center justify-center px-2 mr-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">{badge}</Text>
        </View>
      ) : null}
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}>›</Text>
    </Pressable>
  );
}
