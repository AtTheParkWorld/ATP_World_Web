/**
 * Live now — current streams across the network. Tier-gated streams
 * surface a lock icon + "Premium only" badge when the viewer doesn't
 * have access. Tap a card → /live/[id] for the playback screen.
 */
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLiveStreams, type LiveStream } from '@/lib/api/streams';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function LiveIndex() {
  const qc = useQueryClient();
  const q  = useQuery({
    queryKey: ['live-streams'],
    queryFn:  () => listLiveStreams().then(r => r.streams),
    refetchInterval: 15_000,
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Live now
        </Text>
        <View className="ml-3 px-2 py-0.5 rounded bg-atp-red">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-[10px] uppercase tracking-widest">
            ● LIVE
          </Text>
        </View>
      </View>

      <FlatList
        data={q.data || []}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <LiveCard stream={item} />}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['live-streams'] })}
          />
        }
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            {q.isLoading
              ? <ActivityIndicator color={colors.green} />
              : <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
                  No live streams right now. Coaches go live before + during sessions.
                </Text>}
          </View>
        }
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

function LiveCard({ stream }: { stream: LiveStream }) {
  return (
    <Pressable
      onPress={() => router.push(`/live/${stream.id}`)}
      className="mx-5 mb-3 bg-atp-dark rounded-atp-lg border border-white/5 overflow-hidden active:opacity-70"
    >
      <View className="relative">
        {stream.host_photo ? (
          <Image
            source={{ uri: absUrl(stream.host_photo)! }}
            className="w-full"
            style={{ aspectRatio: 16 / 9, backgroundColor: colors.dark2 }}
            resizeMode="cover"
          />
        ) : (
          <View className="w-full items-center justify-center" style={{ aspectRatio: 16 / 9, backgroundColor: colors.dark2 }}>
            <Text style={{ fontSize: 48 }}>📡</Text>
          </View>
        )}
        <View className="absolute top-2 left-2 flex-row items-center gap-2">
          <View className="px-2 py-0.5 rounded bg-atp-red">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-[10px] uppercase tracking-widest">
              ● LIVE
            </Text>
          </View>
          {stream.is_locked && (
            <View className="px-2 py-0.5 rounded bg-black/70 border border-warning/40">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-[10px] uppercase tracking-widest">
                🔒 {stream.tier_required}
              </Text>
            </View>
          )}
        </View>
        <View className="absolute bottom-2 right-2 bg-black/70 rounded px-2 py-0.5">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">
            👀 {stream.concurrent_viewers}
          </Text>
        </View>
      </View>
      <View className="p-4">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase tracking-tight">
          {stream.title}
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
          {stream.first_name} {stream.last_name}{stream.host_role !== 'member' ? ` · ${stream.host_role}` : ''}
        </Text>
        {!!stream.session_name && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
            From: {stream.session_name}
            {stream.session_location ? ` · 📍 ${stream.session_location}` : ''}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
