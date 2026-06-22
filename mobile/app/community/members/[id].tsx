/**
 * Member profile (other member view).
 *
 * Header has avatar + name + tribe badge + city, then a friendship
 * action row whose label changes based on relationship:
 *   stranger  → "Add friend"
 *   pending   → "Cancel request" (we sent) / "Accept / Pass" (they sent)
 *   accepted  → "Friends ✓" + Unfriend in overflow menu
 *   blocked   → "Unblock"  (only if WE blocked them)
 *
 * Below: their upcoming sessions (if friends) + a "Report" link
 * tucked at the bottom for App-Store-required moderation surface.
 */
import { Alert, FlatList, Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api/client';
import {
  listFriends,
  sendFriendRequest,
  respondToRequest,
  unfriend,
  blockMember,
  reportMember,
  type Friendship,
} from '@/lib/api/friends';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { useAuthStore } from '@/lib/stores/auth.store';
import { absUrl } from '@/lib/utils/imageUrl';

interface PublicMember {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  tribe_name?: string | null;
  tribe_slug?: string | null;
  city_name?: string | null;
  is_ambassador?: boolean;
  member_number?: string | null;
  joined_at?: string | null;
}

function getPublicMember(id: string): Promise<{ member: PublicMember }> {
  // Backend exposes /api/members/leaderboard + search but no single
  // "public profile" endpoint. We piggyback on search by id-as-name,
  // and fall back to a stub if not found — the rest of the screen
  // (friendship state) still works.
  return api.get(`/members/${id}/public`).catch((err) => {
    if (err instanceof ApiError && err.status === 404) {
      return { member: { id, first_name: 'Member', last_name: '', avatar_url: null } };
    }
    throw err;
  });
}

interface UpcomingBooking {
  id: number;
  session_id: number;
  session_name: string;
  scheduled_at: string;
  city_name: string | null;
  tribe_name: string | null;
}
function getFriendsUpcoming(id: string): Promise<{ bookings: UpcomingBooking[] }> {
  return api.get(`/members/${id}/upcoming-bookings`).catch((err) => {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return { bookings: [] };
    }
    throw err;
  });
}

export default function MemberProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = String(id);
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member);

  const memberQ = useQuery({
    queryKey: ['public-member', memberId],
    queryFn:  () => getPublicMember(memberId).then(r => r.member),
    enabled: !!memberId,
  });

  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn:  () => listFriends().then(r => r.friendships),
  });

  const upcomingQ = useQuery({
    queryKey: ['member-upcoming', memberId],
    queryFn:  () => getFriendsUpcoming(memberId).then(r => r.bookings),
    enabled:  !!memberId,
  });

  const relationship: Friendship | undefined = (friendsQ.data || []).find((f) => f.friend_id === memberId);
  const isMe = me?.id === memberId;

  const addMu = useMutation({
    mutationFn: () => sendFriendRequest(memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
    onError: (err) => Alert.alert('Could not add friend', (err as Error).message || 'Try again.'),
  });
  const respondMu = useMutation({
    mutationFn: (status: 'accepted' | 'declined') => respondToRequest(relationship!.id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
  const unfriendMu = useMutation({
    mutationFn: () => unfriend(relationship!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });
  const blockMu = useMutation({
    mutationFn: () => blockMember(memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friends'] });
      router.back();
    },
  });
  const reportMu = useMutation({
    mutationFn: (reason: string) => reportMember(memberId, reason),
    onSuccess: () => Alert.alert('Reported', 'Thanks. A moderator will review within 24 hours.'),
  });

  const m = memberQ.data;
  const tColor = tribeColor(m?.tribe_slug);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
          Profile
        </Text>
        {!isMe && (
          <Pressable
            onPress={() => {
              Alert.alert('Member actions', undefined, [
                { text: 'Report this member', onPress: () => {
                    Alert.alert('Reason?', undefined, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Harassment',    onPress: () => reportMu.mutate('harassment') },
                      { text: 'Impersonation', onPress: () => reportMu.mutate('impersonation') },
                      { text: 'Spam',          onPress: () => reportMu.mutate('spam') },
                    ]);
                  } },
                { text: 'Block', style: 'destructive', onPress: () => {
                    Alert.alert(
                      'Block this member?',
                      'They won\'t be able to see your posts or message you. You can unblock later from Settings.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Block', style: 'destructive', onPress: () => blockMu.mutate() },
                      ]
                    );
                  } },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
            className="py-2 px-2"
          >
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>⋯</Text>
          </Pressable>
        )}
        {isMe && <View style={{ width: 32 }} />}
      </View>

      <FlatList
        ListHeaderComponent={
          <View className="px-5 pt-6 pb-2 items-center">
            <View
              className="w-24 h-24 rounded-full bg-atp-dark-3 overflow-hidden items-center justify-center"
              style={{ borderWidth: 2, borderColor: tColor }}
            >
              {m?.avatar_url
                ? <Image source={{ uri: absUrl(m.avatar_url)! }} className="w-24 h-24" />
                : <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.muted }} className="text-3xl">
                    {(m?.first_name || '?')[0]}{(m?.last_name || '')[0]}
                  </Text>}
            </View>
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase mt-3">
              {m ? `${m.first_name} ${m.last_name}` : ' '}
            </Text>
            <View className="flex-row items-center gap-2 mt-1">
              {!!m?.tribe_name && (
                <Text style={{ fontFamily: fontFamily.bodyBold, color: tColor }} className="text-xs uppercase tracking-widest">
                  {m.tribe_name}
                </Text>
              )}
              {!!m?.city_name && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                  · 📍 {m.city_name}
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

            {!isMe && (
              <View className="w-full mt-5">
                {(() => {
                  if (!relationship) {
                    return (
                      <Pressable
                        onPress={() => addMu.mutate()}
                        disabled={addMu.isPending}
                        className="bg-atp-green rounded-atp py-3 items-center active:opacity-80"
                      >
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="uppercase tracking-widest text-sm">
                          {addMu.isPending ? 'Sending…' : 'Add friend'}
                        </Text>
                      </Pressable>
                    );
                  }
                  if (relationship.status === 'pending' && relationship.requester_id === me?.id) {
                    return (
                      <Pressable
                        onPress={() => unfriendMu.mutate()}
                        className="bg-atp-dark-3 rounded-atp py-3 items-center active:opacity-80"
                      >
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="uppercase tracking-widest text-sm">
                          Cancel request
                        </Text>
                      </Pressable>
                    );
                  }
                  if (relationship.status === 'pending') {
                    return (
                      <View className="flex-row gap-2">
                        <Pressable
                          onPress={() => respondMu.mutate('accepted')}
                          className="flex-1 bg-atp-green rounded-atp py-3 items-center active:opacity-80"
                        >
                          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="uppercase tracking-widest text-sm">
                            Accept
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => respondMu.mutate('declined')}
                          className="flex-1 bg-atp-dark-3 rounded-atp py-3 items-center active:opacity-80"
                        >
                          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="uppercase tracking-widest text-sm">
                            Pass
                          </Text>
                        </Pressable>
                      </View>
                    );
                  }
                  if (relationship.status === 'accepted') {
                    return (
                      <Pressable
                        onPress={() => Alert.alert(
                          'Unfriend?',
                          'You can send a fresh request later if you change your mind.',
                          [
                            { text: 'Keep', style: 'cancel' },
                            { text: 'Unfriend', style: 'destructive', onPress: () => unfriendMu.mutate() },
                          ]
                        )}
                        className="bg-atp-dark-3 rounded-atp py-3 items-center active:opacity-80"
                      >
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="uppercase tracking-widest text-sm">
                          Friends ✓ · Unfriend
                        </Text>
                      </Pressable>
                    );
                  }
                  return null;
                })()}
              </View>
            )}

            {relationship?.status === 'accepted' && upcomingQ.data && upcomingQ.data.length > 0 && (
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mt-7 self-start">
                Upcoming · train together
              </Text>
            )}
          </View>
        }
        data={relationship?.status === 'accepted' ? (upcomingQ.data || []) : []}
        keyExtractor={(b) => String(b.id)}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/sessions/${item.session_id}`)}
            className="mx-5 mt-2 bg-atp-dark border border-white/5 rounded-atp p-3 active:opacity-70"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{item.session_name}</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
              {new Date(item.scheduled_at).toLocaleString()} {item.city_name ? `· 📍 ${item.city_name}` : ''}
            </Text>
          </Pressable>
        )}
        contentContainerStyle={{ paddingBottom: 60 }}
      />
    </SafeAreaView>
  );
}
