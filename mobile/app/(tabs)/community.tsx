/**
 * Community tab — three sub-views via a segmented control:
 *   Feed      most recent posts (everyone, public + your tribe)
 *   Coaches   directory of certified ATP coaches
 *   Friends   accepted friends + pending requests
 *
 * Each sub-view is its own component, so the segmented control is the
 * only persistent UI. State (search query, post composer) doesn't
 * survive a switch — that's intentional, keeps mental load light.
 *
 * A floating "+" button in the bottom-right opens the composer when
 * Feed is active.
 */
import { useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFeed, toggleLike, type Post } from '@/lib/api/community';
import { listCoaches } from '@/lib/api/coaches';
import { listFriends, respondToRequest, searchMembers, type Friendship } from '@/lib/api/friends';
import { PostCard } from '@/lib/components/PostCard';
import { SegmentedControl } from '@/lib/components/SegmentedControl';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { LoadError } from '@/lib/components/LoadError';
import { useAuthStore } from '@/lib/stores/auth.store';
import { absUrl } from '@/lib/utils/imageUrl';
import { Avatar } from '@/lib/components/Avatar';

type Tab = 'feed' | 'coaches' | 'friends';

export default function Community() {
  const [tab, setTab] = useState<Tab>('feed');

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-3 pb-3">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight">
          Community
        </Text>
        <View className="mt-3">
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'feed',    label: 'Feed' },
              { value: 'coaches', label: 'Coaches' },
              { value: 'friends', label: 'Friends' },
            ]}
          />
        </View>
      </View>
      {tab === 'feed'    && <FeedView />}
      {tab === 'coaches' && <CoachesView />}
      {tab === 'friends' && <FriendsView />}

      {tab === 'feed' && (
        <Pressable
          onPress={() => router.push('/community/compose')}
          className="absolute bottom-6 right-6 w-14 h-14 rounded-full items-center justify-center bg-atp-green active:opacity-80"
          style={{ elevation: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
        >
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.black, fontSize: 28, lineHeight: 30 }}>
            +
          </Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* Feed                                                            */
/* ─────────────────────────────────────────────────────────────── */
function FeedView() {
  const qc = useQueryClient();
  const feedQ = useQuery({
    queryKey: ['feed'],
    queryFn:  () => getFeed({ limit: 25 }).then(r => r.posts),
  });

  const likeMu = useMutation({
    mutationFn: (postId: number) => toggleLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: ['feed'] });
      const prev = qc.getQueryData<Post[]>(['feed']);
      qc.setQueryData<Post[] | undefined>(['feed'], (xs) =>
        xs?.map((p) =>
          p.id === postId
            ? { ...p, liked_by_me: !p.liked_by_me, likes_count: p.likes_count + (p.liked_by_me ? -1 : 1) }
            : p
        )
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => { if (ctx?.prev) qc.setQueryData(['feed'], ctx.prev); },
  });

  return (
    <FlatList
      data={feedQ.data || []}
      keyExtractor={(p) => String(p.id)}
      renderItem={({ item }) => (
        <View className="px-5 mb-3">
          <PostCard post={item} onLikePress={() => likeMu.mutate(item.id)} />
        </View>
      )}
      refreshControl={
        <RefreshControl
          tintColor={colors.green}
          refreshing={feedQ.isFetching && !feedQ.isLoading}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['feed'] })}
        />
      }
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 100 }}
      ListEmptyComponent={
        feedQ.isError ? (
          <View className="px-5 pt-12">
            <LoadError onRetry={() => feedQ.refetch()} />
          </View>
        ) : (
          <View className="px-8 pt-12 items-center">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
              {feedQ.isLoading ? 'Loading feed…' : 'No posts yet. Be the first to share.'}
            </Text>
          </View>
        )
      }
    />
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* Coaches                                                         */
/* ─────────────────────────────────────────────────────────────── */
function CoachesView() {
  const coachesQ = useQuery({
    queryKey: ['coaches'],
    queryFn:  () => listCoaches().then(r => r.coaches),
    staleTime: 1000 * 60 * 10,
  });

  return (
    <FlatList
      data={coachesQ.data || []}
      keyExtractor={(c) => c.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 100, gap: 12 }}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/coaches/${item.id}`)}
          className="flex-1 bg-atp-dark rounded-atp-lg border border-white/5 p-4 active:opacity-70"
        >
          <View className="w-full aspect-square rounded-atp bg-atp-dark-3 mb-3 overflow-hidden items-center justify-center">
            {item.profile?.profile_photo_url ? (
              <Image source={{ uri: absUrl(item.profile.profile_photo_url)! }} className="w-full h-full" resizeMode="cover" />
            ) : (
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.muted }} className="text-3xl">
                {item.first_name[0]}{item.last_name[0]}
              </Text>
            )}
          </View>
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
            {item.display_name || `${item.first_name} ${item.last_name}`}
          </Text>
          {!!item.city && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
              📍 {item.city}
            </Text>
          )}
          {item.stats?.rating_avg > 0 && item.stats?.rating_count > 0 && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.warning }} className="text-xs mt-1">
              ★ {item.stats.rating_avg.toFixed(1)} · {item.stats.rating_count}
            </Text>
          )}
          {!!item.profile?.tagline && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-0.5" numberOfLines={2}>
              {item.profile.tagline}
            </Text>
          )}
        </Pressable>
      )}
      ListEmptyComponent={
        <View className="px-8 pt-12 items-center">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
            {coachesQ.isLoading ? 'Loading coaches…' : 'No coaches yet.'}
          </Text>
        </View>
      }
    />
  );
}

/* ─────────────────────────────────────────────────────────────── */
/* Friends                                                         */
/* ─────────────────────────────────────────────────────────────── */
function FriendsView() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member);

  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn:  () => listFriends().then(r => r.friendships),
  });

  const [searchQ, setSearchQ] = useState('');
  const searchResults = useQuery({
    queryKey: ['member-search', searchQ],
    queryFn:  () => searchMembers(searchQ).then(r => r.members),
    enabled:  searchQ.length >= 2,
  });

  const respondMu = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'accepted' | 'declined' }) =>
      respondToRequest(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  });

  const pending  = (friendsQ.data || []).filter((f) => f.status === 'pending'  && f.requester_id !== me?.id);
  const sent     = (friendsQ.data || []).filter((f) => f.status === 'pending'  && f.requester_id === me?.id);
  const accepted = (friendsQ.data || []).filter((f) => f.status === 'accepted');

  return (
    <FlatList
      ListHeaderComponent={
        <View className="px-5 pt-2 pb-4">
          <View className="bg-atp-dark border border-white/5 rounded-atp px-3 py-2.5 flex-row items-center">
            <Text style={{ color: colors.muted }} className="mr-2">🔍</Text>
            <TextInput
              value={searchQ}
              onChangeText={setSearchQ}
              placeholder="Search members by name…"
              placeholderTextColor={colors.muted}
              style={{ fontFamily: fontFamily.body, color: colors.white, flex: 1 }}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {searchQ.length >= 2 && (
            <View className="mt-3 gap-2">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                Search results
              </Text>
              {(searchResults.data || []).map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => router.push(`/community/members/${m.id}`)}
                  className="flex-row items-center gap-3 bg-atp-dark border border-white/5 rounded-atp p-3 active:opacity-70"
                >
                  <Avatar
                    uri={m.avatar_url}
                    firstName={m.first_name}
                    lastName={m.last_name}
                    id={m.id}
                    size={40}
                  />
                  <View className="flex-1">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{m.first_name} {m.last_name}</Text>
                    {!!m.city_name && (
                      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">📍 {m.city_name}</Text>
                    )}
                  </View>
                </Pressable>
              ))}
              {searchResults.data && searchResults.data.length === 0 && !searchResults.isLoading && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">No matches.</Text>
              )}
            </View>
          )}

          {pending.length > 0 && (
            <View className="mt-5 gap-2">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                Requests waiting on you
              </Text>
              {pending.map((f) => (
                <View key={f.id} className="bg-atp-dark border border-white/5 rounded-atp p-3 flex-row items-center gap-3">
                  <FriendAvatar friend={f} />
                  <View className="flex-1">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{f.first_name} {f.last_name}</Text>
                    {!!f.tribe_name && (
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: tribeColor(f.tribe_slug) }} className="text-xs uppercase tracking-widest">
                        {f.tribe_name}
                      </Text>
                    )}
                  </View>
                  <Pressable
                    onPress={() => respondMu.mutate({ id: f.id, status: 'accepted' })}
                    className="bg-atp-green rounded-atp px-3 py-2 active:opacity-80"
                  >
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">
                      Accept
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respondMu.mutate({ id: f.id, status: 'declined' })}
                    className="bg-atp-dark-3 rounded-atp px-3 py-2 active:opacity-80"
                  >
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest">
                      Pass
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {accepted.length > 0 && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mt-5">
              Your friends
            </Text>
          )}
        </View>
      }
      data={accepted}
      keyExtractor={(f) => String(f.id)}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/community/members/${item.friend_id}`)}
          className="mx-5 mb-2 bg-atp-dark border border-white/5 rounded-atp p-3 flex-row items-center gap-3 active:opacity-70"
        >
          <FriendAvatar friend={item} />
          <View className="flex-1">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{item.first_name} {item.last_name}</Text>
            {!!item.tribe_name && (
              <Text style={{ fontFamily: fontFamily.bodyBold, color: tribeColor(item.tribe_slug) }} className="text-xs uppercase tracking-widest">
                {item.tribe_name}
              </Text>
            )}
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        sent.length > 0 ? (
          <View className="px-5 mt-3">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Sent · waiting on them
            </Text>
            {sent.map((f) => (
              <View key={f.id} className="bg-atp-dark border border-dashed border-white/10 rounded-atp p-3 mb-2 flex-row items-center gap-3">
                <FriendAvatar friend={f} />
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }}>{f.first_name} {f.last_name}</Text>
              </View>
            ))}
          </View>
        ) : null
      }
      refreshControl={
        <RefreshControl
          tintColor={colors.green}
          refreshing={friendsQ.isFetching && !friendsQ.isLoading}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['friends'] })}
        />
      }
      contentContainerStyle={{ paddingBottom: 100 }}
    />
  );
}

function FriendAvatar({ friend }: { friend: { id?: string | number; avatar_url: string | null; first_name: string; last_name?: string; tribe_slug?: string | null } }) {
  return (
    <Avatar
      uri={friend.avatar_url}
      firstName={friend.first_name}
      lastName={friend.last_name}
      id={friend.id}
      size={44}
      borderColor={tribeColor(friend.tribe_slug)}
      borderWidth={1}
    />
  );
}
