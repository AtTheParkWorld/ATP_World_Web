/**
 * Profile tab — your member identity, QR code, and entry points to
 * settings + privacy + help.
 *
 * Sections (top → bottom):
 *  - Avatar + name + tribe + member#
 *  - "My Next Session" card (shared with Home; founder 2026-08-01)
 *  - QR card (member_number encoded; ambassadors scan it at sessions)
 *  - Profile completion progress (drives the +200 pts profile_complete
 *    bonus) with tappable "Add <field>" chips from profile_missing
 *  - Stat strip: sessions / streak / friends
 *  - Grouped settings cards (founder 2026-08-05: premium look):
 *    Activity · Community · Account · Privacy & Support — each an
 *    iOS-style rounded surface card with hairline-separated rows
 *  - Sign out (always visible so a broken session is recoverable)
 */
import { useEffect, type ReactNode } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfile, getStats, getStreak } from '@/lib/api/members';
import { getMyAchievements } from '@/lib/api/achievements';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Avatar } from '@/lib/components/Avatar';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { StreakBadge } from '@/lib/components/StreakBadge';
import { MyNextSession } from '@/lib/components/MyNextSession';
import { NotificationBell } from '@/lib/components/NotificationBell';
import { Icon, type IconName } from '@/lib/components/icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * "ATP 1.1.0 (15) · ota 4f2c9ab" — version, TestFlight build number,
 * and the id of the over-the-air update currently running. During
 * testing this is the single source of truth for what a phone is
 * actually showing; "embedded" means no OTA has been applied yet.
 */
function buildStamp(): string {
  const version = Constants.expoConfig?.version ?? '—';
  const build =
    Constants.expoConfig?.ios?.buildNumber ??
    (Constants.expoConfig as any)?.android?.versionCode ??
    '—';
  const ota = Updates.isEmbeddedLaunch
    ? 'embedded'
    : (Updates.updateId?.slice(0, 7) ?? 'embedded');
  return `ATP ${version} (${build}) · ota ${ota}`;
}

export default function Profile() {
  const qc = useQueryClient();
  const member  = useAuthStore((s) => s.member) as any;
  const updateMember = useAuthStore((s) => s.updateMember);
  const signOut = useAuthStore((s) => s.signOut);

  const profileQ = useQuery({ queryKey: ['profile'], queryFn: () => getProfile().then(r => r.member) });
  const statsQ   = useQuery({ queryKey: ['stats'],   queryFn: () => getStats().then(r => r.stats) });
  const streakQ  = useQuery({ queryKey: ['streak'],  queryFn: () => getStreak().then(r => r.streak) });
  // Badges belong on the profile — they were only reachable via
  // Rewards → Badges, so members thought they had none (founder
  // 2026-09-12).
  const achQ = useQuery({ queryKey: ['achievements'], queryFn: () => getMyAchievements() });

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
                qc.invalidateQueries({ queryKey: ['my-bookings'] }),
              ]);
            }}
          />
        }
      >
        {/* Bell sits top-right of the identity block — same inbox the
            Home bell opens (founder 2026-09-09). */}
        <View className="flex-row justify-end px-5 pt-3">
          <NotificationBell />
        </View>

        {/* Identity */}
        <View className="items-center pt-1 pb-3 px-5">
          <Pressable onPress={() => router.push('/profile/edit')}>
            <Avatar
              uri={m?.avatar_url}
              firstName={m?.first_name}
              lastName={m?.last_name}
              id={m?.id}
              size="xl"
              borderColor={tColor}
              borderWidth={2}
            />
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

        {/* My next session — same card as Home (founder 2026-08-01) */}
        <View className="px-5 mt-4">
          <MyNextSession />
        </View>

        {/* Member QR removed 2026-06-27 per founder — it confused members
            with the per-booking session QR (the one that actually gets
            scanned at check-in, reachable from Home → booked session →
            Tap to show QR). */}

        {/* Profile completion — % from the API plus actionable "Add X"
            chips built from profile_missing (backend computes both live,
            so the list is exactly what's left to fill). */}
        {m?.profile_complete_pct != null && m.profile_complete_pct < 100 && (
          <View className="px-5 mt-5">
            <View className="bg-atp-dark border border-white/5 rounded-atp-lg p-4">
              <View className="flex-row items-center justify-between">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                  Profile {m.profile_complete_pct}% complete
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px]">
                  +200 pts when done
                </Text>
              </View>
              <View className="mt-3 h-1.5 bg-atp-dark-3 rounded-full overflow-hidden">
                <View className="h-full bg-atp-green rounded-full" style={{ width: `${m.profile_complete_pct}%` }} />
              </View>
              {(m.profile_missing?.length ?? 0) > 0 ? (
                <View className="flex-row flex-wrap gap-2 mt-3.5">
                  {(m.profile_missing as { field: string; label: string }[]).map(({ field, label }) => (
                    <Pressable
                      key={field}
                      onPress={() => router.push('/profile/edit')}
                      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
                      className="flex-row items-center border border-atp-green/40 bg-atp-green/10 rounded-full px-3 py-1.5 active:opacity-80"
                    >
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
                        {'+ '}{label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                // Older cached payloads may lack profile_missing — keep
                // the pre-chips tap-through-to-edit affordance.
                <Pressable onPress={() => router.push('/profile/edit')} className="mt-2 active:opacity-80">
                  <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm">
                    Finish your profile to claim +200 pts.
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Complete state — quiet one-liner (reads more premium than a
            vanished card: confirms there's nothing left to chase). */}
        {m?.profile_complete_pct != null && m.profile_complete_pct >= 100 && (
          <View className="px-5 mt-5">
            <View className="flex-row items-center justify-center gap-2 py-1">
              <Icon name="check" size={14} color={colors.green} />
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                Profile complete
              </Text>
            </View>
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

        {/* Badges — unlocked achievements, newest first. Tapping any of
            them opens the full wall under Rewards. */}
        {!!achQ.data && (
          <View className="px-5 mt-6">
            <Pressable
              onPress={() => router.push('/(tabs)/rewards')}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
              className="flex-row items-center justify-between mb-3 active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                My badges
              </Text>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                {achQ.data.unlocked_count}/{achQ.data.achievements.length} →
              </Text>
            </Pressable>
            {achQ.data.unlocked_count > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginRight: -20 }} contentContainerStyle={{ paddingRight: 20 }}>
                {achQ.data.achievements
                  .filter((a) => a.unlocked)
                  .map((a) => (
                    <Pressable
                      key={String(a.id)}
                      onPress={() => router.push('/(tabs)/rewards')}
                      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
                      className="items-center mr-3 bg-atp-dark border border-atp-green/30 rounded-atp-lg px-3 py-3"
                      accessibilityLabel={a.name}
                    >
                      {a.badge_image_url ? (
                        <Image source={{ uri: a.badge_image_url }} style={{ width: 40, height: 40, borderRadius: 20 }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 30 }}>{a.icon || '🏅'}</Text>
                      )}
                      <Text
                        numberOfLines={1}
                        style={{ fontFamily: fontFamily.bodyBold, color: colors.light, maxWidth: 76 }}
                        className="text-[10px] mt-1.5 text-center"
                      >
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
              </ScrollView>
            ) : (
              <Pressable
                onPress={() => router.push('/(tabs)/rewards')}
                className="bg-atp-dark border border-dashed border-white/10 rounded-atp-lg p-4 active:opacity-80"
              >
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm">
                  No badges yet — attend sessions, build a streak and bring friends to start unlocking them.
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Role-specific tools (Ambassador / Coach) */}
        {(m?.is_ambassador || (m as any)?.is_coach) && (
          <SettingsGroup title={(m?.is_ambassador && (m as any)?.is_coach) ? 'Ambassador + Coach tools' : m?.is_ambassador ? 'Ambassador tools' : 'Coach tools'}>
            {m?.is_ambassador && (
              <SettingsRow label="Ambassador dashboard" icon="ticket" onPress={() => router.push('/ambassador')} last={!(m as any)?.is_coach} />
            )}
            {(m as any)?.is_coach && (
              <SettingsRow label="Coach dashboard" icon="dumbbell" onPress={() => router.push('/coach')} last />
            )}
          </SettingsGroup>
        )}

        {/* Be a Supporter */}
        <View className="px-5 mt-7">
          <Pressable
            onPress={() => router.push('/supporter')}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
            className="bg-atp-green/10 border border-atp-green/40 rounded-atp-lg p-4 active:opacity-80 flex-row items-center"
          >
            <View style={{ marginRight: 12 }}>
              <Icon name="heart" size={24} color={colors.green} active />
            </View>
            <View className="flex-1">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm uppercase tracking-widest">
                {m?.subscription_type === 'premium' || m?.subscription_type === 'premium_plus' ? 'You\'re a supporter' : 'Be a supporter'}
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-1">
                {m?.subscription_type === 'premium' || m?.subscription_type === 'premium_plus'
                  ? 'Manage your plan + perks.'
                  : 'Keep ATP free for everyone. Unlock tribe-only sessions + live streams.'}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.green} />
          </Pressable>
        </View>

        {/* Grouped settings — iOS-style cards, one card per concern.
            Same destinations as the old flat "Quick links" list. */}
        <SettingsGroup title="Activity">
          <SettingsRow label="My bookings"  icon="calendar" onPress={() => router.push('/bookings')} />
          <SettingsRow label="Leaderboard"  icon="trophy"   onPress={() => router.push('/leaderboard')} />
          <SettingsRow label="Challenges"   icon="target"   onPress={() => router.push('/challenges')} last />
        </SettingsGroup>

        <SettingsGroup title="Community">
          <SettingsRow label="My Crew"   icon="users" onPress={() => router.push('/crew')} />
          <SettingsRow label="Messages"  icon="chat"  onPress={() => router.push('/messages')} />
          <SettingsRow label="Stories"   icon="story" onPress={() => router.push('/blog')} />
          <SettingsRow label="ATP Store" icon="bag"   onPress={() => router.push('/store')} last />
        </SettingsGroup>

        <SettingsGroup title="Account">
          <SettingsRow label="Edit profile"  icon="edit"         onPress={() => router.push('/profile/edit')} />
          <SettingsRow label="Notifications" icon="notification" onPress={() => router.push('/profile/notifications')} last />
        </SettingsGroup>

        <SettingsGroup title="Privacy & support">
          <SettingsRow label="Privacy"         icon="shield"   onPress={() => router.push('/profile/privacy')} />
          <SettingsRow label="Blocked members" icon="no-entry" onPress={() => router.push('/profile/blocked')} />
          <SettingsRow label="Help & support"  icon="help"     onPress={() => router.push('/profile/help')} />
          <SettingsRow label="About"           icon="info"     onPress={() => router.push('/profile/about')} last />
        </SettingsGroup>

        {/* Sign out */}
        <View className="px-5 mt-7">
          <Pressable
            onPress={async () => {
              await signOut();
              router.replace('/(auth)/welcome');
            }}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
            className="rounded-atp-lg border border-white/10 py-3.5 items-center bg-atp-dark active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-sm uppercase tracking-widest">
              Sign out
            </Text>
          </Pressable>
        </View>

        {/* Build stamp — tiny, but it ends the "is this the new version?"
            guessing game during testing: the app number is the binary
            from TestFlight, the short id after it changes every time an
            over-the-air update lands. */}
        <View className="px-5 mt-5 items-center">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] tracking-wider">
            {buildStamp()}
          </Text>
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

/**
 * Grouped-settings card (founder 2026-08-05: premium look for the
 * profile "drop down tabs"). Micro-header + one rounded surface card;
 * children are SettingsRows separated by hairlines.
 */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="px-5 mt-6">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2 ml-1">
        {title}
      </Text>
      <View className="bg-atp-dark border border-white/5 rounded-atp-lg overflow-hidden">
        {children}
      </View>
    </View>
  );
}

function SettingsRow({
  label,
  subtitle,
  icon,
  onPress,
  last = false,
}: {
  label: string;
  subtitle?: string;
  icon: IconName;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      // Same press feel as Home's Quick Actions: slight sink reads as a
      // physical button rather than a plain opacity flash.
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
      className={`flex-row items-center px-4 py-3 active:bg-white/5 ${last ? '' : 'border-b border-white/5'}`}
    >
      <View
        style={{ width: 34, height: 34, marginRight: 12 }}
        className="rounded-atp bg-white/5 items-center justify-center"
      >
        <Icon name={icon} size={18} color={colors.green} />
      </View>
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
      <Icon name="chevron-right" size={16} color={colors.muted} />
    </Pressable>
  );
}
