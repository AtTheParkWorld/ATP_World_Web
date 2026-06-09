/**
 * Profile tab — your member identity, QR code, and entry points to
 * settings + privacy + help.
 *
 * Sections (top → bottom):
 *  - Avatar + name + tribe + member#
 *  - QR card (member_number encoded; ambassadors scan it at sessions)
 *  - Profile completion progress (drives the +200 pts profile_complete bonus)
 *  - Stat strip: sessions / streak / friends
 *  - Quick links: Edit profile · Settings · Privacy · Help · About
 *  - Sign out (always visible so a broken session is recoverable)
 */
import { useEffect } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfile, getStats, getStreak } from '@/lib/api/members';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { StreakBadge } from '@/lib/components/StreakBadge';

export default function Profile() {
  const qc = useQueryClient();
  const member  = useAuthStore((s) => s.member) as any;
  const updateMember = useAuthStore((s) => s.updateMember);
  const signOut = useAuthStore((s) => s.signOut);

  const profileQ = useQuery({ queryKey: ['profile'], queryFn: () => getProfile().then(r => r.member) });
  const statsQ   = useQuery({ queryKey: ['stats'],   queryFn: () => getStats().then(r => r.stats) });
  const streakQ  = useQuery({ queryKey: ['streak'],  queryFn: () => getStreak().then(r => r.streak) });

  // Keep auth store member in sync with backend
  useEffect(() => {
    if (profileQ.data) updateMember(profileQ.data as any);
  }, [profileQ.data, updateMember]);

  const m = profileQ.data || member;
  const name = `${m?.first_name || ''} ${m?.last_name || ''}`.trim() || 'Member';
  const tColor = tribeColor((m as any)?.tribe_slug);
  const refreshing = profileQ.isFetching || statsQ.isFetching || streakQ.isFetching;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={refreshing}
            onRefresh={async () => {
              await Promise.all([
                qc.invalidateQueries({ queryKey: ['profile'] }),
                qc.invalidateQueries({ queryKey: ['stats'] }),
                qc.invalidateQueries({ queryKey: ['streak'] }),
              ]);
            }}
          />
        }
      >
        {/* Identity */}
        <View className="items-center pt-6 pb-3 px-5">
          <Pressable
            onPress={() => router.push('/profile/edit')}
            className="w-28 h-28 rounded-full bg-atp-dark-3 overflow-hidden items-center justify-center"
            style={{ borderWidth: 2, borderColor: tColor }}
          >
            {m?.avatar_url
              ? <Image source={{ uri: m.avatar_url }} className="w-28 h-28" />
              : <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.muted }} className="text-3xl">
                  {(m?.first_name || '?')[0]}{(m?.last_name || '')[0]}
                </Text>}
          </Pressable>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase mt-3 text-center">
            {name}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-1">
            {m?.email}
          </Text>
          <View className="flex-row items-center gap-2 mt-2">
            {!!(m as any)?.tribe_name && (
              <Text style={{ fontFamily: fontFamily.bodyBold, color: tColor }} className="text-xs uppercase tracking-widest">
                {(m as any).tribe_name}
              </Text>
            )}
            {!!m?.member_number && (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                · #{m.member_number}
              </Text>
            )}
            {m?.is_ambassador && (
              <View className="bg-atp-green/15 border border-atp-green/40 px-2 py-0.5 rounded-full">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[10px] uppercase tracking-widest">
                  Ambassador
                </Text>
              </View>
            )}
          </View>
          <View className="mt-3">
            <StreakBadge streak={streakQ.data || null} compact />
          </View>
        </View>

        {/* QR */}
        {!!m?.member_number && (
          <View className="px-5 mt-3">
            <View className="bg-atp-white rounded-atp-lg p-5 items-center">
              <QRCode value={`ATP:${m.member_number}`} size={170} backgroundColor="white" color="#0a0a0a" />
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest mt-3">
                #{m.member_number}
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: '#666' }} className="text-xs mt-1">
                Ambassadors scan this at check-in.
              </Text>
            </View>
          </View>
        )}

        {/* Profile completion */}
        {m?.profile_complete_pct != null && m.profile_complete_pct < 100 && (
          <View className="px-5 mt-5">
            <Pressable
              onPress={() => router.push('/profile/edit')}
              className="bg-atp-dark border border-white/5 rounded-atp p-4 active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                Profile {m.profile_complete_pct}% complete
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
                Finish your profile to claim +200 pts.
              </Text>
              <View className="mt-3 h-1.5 bg-atp-dark-3 rounded-full overflow-hidden">
                <View className="h-full bg-atp-green" style={{ width: `${m.profile_complete_pct}%` }} />
              </View>
            </Pressable>
          </View>
        )}

        {/* Stats */}
        {statsQ.data && (
          <View className="px-5 mt-5 flex-row gap-3">
            <StatTile label="Sessions"   value={String(statsQ.data.total_sessions)} />
            <StatTile label="Points"     value={statsQ.data.current_balance.toLocaleString()} />
            <StatTile label="Friends"    value={String(statsQ.data.friends_count)} />
          </View>
        )}

        {/* Quick links */}
        <View className="px-5 mt-7 gap-2">
          <LinkRow label="Edit profile"  emoji="✏️" onPress={() => router.push('/profile/edit')} />
          <LinkRow label="Notifications" emoji="🔔" onPress={() => router.push('/profile/notifications')} />
          <LinkRow label="Privacy"       emoji="🔒" onPress={() => router.push('/profile/privacy')} />
          <LinkRow label="Blocked members" emoji="🚫" onPress={() => router.push('/profile/blocked')} />
          <LinkRow label="Help & support" emoji="💬" onPress={() => router.push('/profile/help')} />
          <LinkRow label="About"         emoji="ℹ️" onPress={() => router.push('/profile/about')} />
        </View>

        {/* Sign out */}
        <View className="px-5 mt-7">
          <Pressable
            onPress={signOut}
            className="rounded-atp border border-white/10 py-3 items-center bg-atp-dark active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-sm uppercase tracking-widest">
              Sign out
            </Text>
          </Pressable>
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

function LinkRow({ label, emoji, onPress }: { label: string; emoji: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-atp-dark border border-white/5 rounded-atp px-4 py-3.5 active:opacity-70"
    >
      <Text style={{ fontSize: 18, marginRight: 12 }}>{emoji}</Text>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1">
        {label}
      </Text>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}>›</Text>
    </Pressable>
  );
}
