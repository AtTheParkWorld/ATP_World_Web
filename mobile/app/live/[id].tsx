/**
 * Live stream player. expo-av Video plays the HLS .m3u8 the backend
 * computes from the host's chunked uploads.
 *
 * Tier gate: if backend says is_locked, we show an upsell card with a
 * link to Be a Supporter (Phase 14). For unlocked streams we mark a
 * view immediately on mount (drives the analytics + concurrent count).
 */
import { useEffect, useRef } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Video, ResizeMode } from 'expo-av';
import { listLiveStreams, trackView } from '@/lib/api/streams';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function LivePlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const streamId = String(id || '');
  const qc = useQueryClient();
  const videoRef = useRef<Video>(null);

  const liveQ = useQuery({
    queryKey: ['live-streams'],
    queryFn:  () => listLiveStreams().then(r => r.streams),
    refetchInterval: 15_000,
  });
  const stream = liveQ.data?.find((s) => s.id === streamId);

  // Mark view + grab the HLS URL once we know the stream isn't locked.
  const viewQ = useQuery({
    queryKey: ['stream-view', streamId],
    queryFn:  () => trackView(streamId),
    enabled:  !!streamId && !!stream && !stream.is_locked,
  });

  // Auto-refresh when the host ends the stream and we're still on this screen.
  useEffect(() => {
    if (!stream && liveQ.data) {
      // Stream disappeared from /live → host ended it.
      Alert.alert(
        'Stream ended',
        'The host wrapped up. Tap OK to go back to the live list.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }
  }, [stream, liveQ.data]);

  if (!stream) {
    return (
      <SafeAreaView className="flex-1 bg-atp-black items-center justify-center" edges={['top']}>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>Stream not found.</Text>
        <Pressable onPress={() => router.back()} className="mt-6 px-5 py-3 bg-atp-dark-3 rounded-atp">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const hlsUrl = viewQ.data?.playback?.hls_url;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <View className="ml-3 px-2 py-0.5 rounded bg-atp-red">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-[10px] uppercase tracking-widest">
            ● LIVE
          </Text>
        </View>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="ml-auto text-xs">
          👀 {stream.concurrent_viewers}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Player */}
        <View style={{ aspectRatio: 16 / 9, backgroundColor: '#000' }}>
          {stream.is_locked ? (
            <View className="flex-1 items-center justify-center px-8">
              <Text style={{ fontSize: 56 }}>🔒</Text>
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase mt-3 text-center">
                {stream.tier_required.replace('_', ' ')} only
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2 text-center">
                This stream is available to {stream.tier_required.replace('_', ' ')} supporters.
              </Text>
              <Pressable
                onPress={() => router.push('/supporter')}
                className="mt-5 bg-atp-green rounded-atp px-6 py-3 active:opacity-80"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                  Become a supporter
                </Text>
              </Pressable>
            </View>
          ) : hlsUrl ? (
            <Video
              ref={videoRef}
              source={{ uri: hlsUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping={false}
              useNativeControls
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                Loading…
              </Text>
            </View>
          )}
        </View>

        {/* Title + host */}
        <View className="px-5 mt-4">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
            {stream.title}
          </Text>
          <Pressable
            onPress={() => router.push(`/community/members/${stream.host_member_id}`)}
            className="flex-row items-center gap-3 mt-3 active:opacity-70"
          >
            <View className="w-10 h-10 rounded-full bg-atp-dark-3 overflow-hidden items-center justify-center">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>
                {stream.first_name[0]}
              </Text>
            </View>
            <View>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                {stream.first_name} {stream.last_name}
              </Text>
              {stream.host_role !== 'member' && (
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[10px] uppercase tracking-widest">
                  {stream.host_role}
                </Text>
              )}
            </View>
          </Pressable>
          {!!stream.description && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-4 leading-relaxed">
              {stream.description}
            </Text>
          )}
          {!!stream.session_name && (
            <View className="mt-4 bg-atp-dark border border-white/5 rounded-atp p-3">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-1">
                From session
              </Text>
              <Pressable onPress={() => stream.session_id && router.push(`/sessions/${stream.session_id}`)}>
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">
                  {stream.session_name}
                </Text>
                {!!stream.session_location && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-0.5">
                    📍 {stream.session_location}
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
