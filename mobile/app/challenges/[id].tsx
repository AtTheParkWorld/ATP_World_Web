/**
 * Challenge detail + per-challenge leaderboard.
 *
 * If the challenge tracks a device metric and the member hasn't
 * connected a wearable, we surface a clear nudge — the on-the-ground
 * problem we hit during testing where members joined a "10k steps"
 * challenge expecting it to work without a connected device.
 */
import { Alert, FlatList, Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { joinChallenge, getMyProgress, getChallengeLeaderboard } from '@/lib/api/challenges';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const challengeId = String(id || '');
  const qc = useQueryClient();

  const progressQ = useQuery({
    queryKey: ['challenge', challengeId],
    queryFn:  () => getMyProgress(challengeId),
    enabled:  !!challengeId,
  });
  const leaderboardQ = useQuery({
    queryKey: ['challenge-leaderboard', challengeId],
    queryFn:  () => getChallengeLeaderboard(challengeId).then(r => r.leaderboard),
    enabled:  !!challengeId,
  });

  const joinMu = useMutation({
    mutationFn: () => joinChallenge(challengeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['challenge', challengeId] });
      qc.invalidateQueries({ queryKey: ['challenges'] });
    },
    onError: (err) => Alert.alert('Could not join', (err as Error).message || 'Try again.'),
  });

  const c        = progressQ.data?.challenge;
  const joined   = !!progressQ.data?.joined;
  const myProg   = Number(progressQ.data?.recomputed?.progress) || 0;
  const target   = Number(c?.target) || 0;
  const pct      = target > 0 ? Math.min(100, Math.round((myProg / target) * 100)) : 0;
  const lb       = leaderboardQ.data || [];

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
      </View>

      <FlatList
        ListHeaderComponent={
          <View>
            {!!(c as any)?.cover_image_url && (
              <Image
                source={{ uri: absUrl((c as any).cover_image_url)! }}
                style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.dark2 }}
                resizeMode="cover"
              />
            )}
            <View className="px-5 mt-4">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight">
                {c?.title || ' '}
              </Text>
              {!!c?.description && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-2 leading-relaxed">
                  {c.description}
                </Text>
              )}
            </View>

            {joined ? (
              <View className="px-5 mt-5">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
                  Your progress
                </Text>
                <View className="h-2 bg-atp-dark-3 rounded-full overflow-hidden">
                  <View className="h-full bg-atp-green" style={{ width: `${pct}%` }} />
                </View>
                <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-sm mt-2">
                  {myProg.toLocaleString()} / {target.toLocaleString()} {c?.unit || ''}  ({pct}%)
                </Text>
                {progressQ.data?.requires_device && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.warning }} className="text-xs mt-2">
                    ⚡ This is a device-tracked challenge. Connect a wearable (Apple Watch / Strava / Garmin) in Profile → Settings to log progress.
                  </Text>
                )}
              </View>
            ) : (
              <View className="px-5 mt-5">
                <Pressable
                  onPress={() => joinMu.mutate()}
                  disabled={joinMu.isPending}
                  className={`rounded-atp py-4 items-center ${joinMu.isPending ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
                >
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
                    {joinMu.isPending ? 'Joining…' : 'Join challenge'}
                  </Text>
                </Pressable>
              </View>
            )}

            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="px-5 text-xs uppercase tracking-widest mt-7 mb-2">
              Leaderboard
            </Text>
          </View>
        }
        data={lb}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => {
          const myProgressBar = c?.target ? Math.min(100, Math.round((item.progress / Number(c.target)) * 100)) : 0;
          return (
            <View className="mx-5 mb-2 bg-atp-dark border border-white/5 rounded-atp p-3 flex-row items-center gap-3">
              <Text
                style={{ fontFamily: fontFamily.displayBlack, color: Number(item.rank) <= 3 ? colors.green : colors.muted }}
                className="text-lg w-8"
              >
                #{item.rank}
              </Text>
              <View className="flex-1">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                  {item.first_name} {item.last_name}
                </Text>
                <View className="h-1 bg-atp-dark-3 rounded-full overflow-hidden mt-1">
                  <View className="h-full bg-atp-green" style={{ width: `${myProgressBar}%` }} />
                </View>
              </View>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
                {item.progress.toLocaleString()}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="px-5 text-sm">
            No one has logged progress yet. Be first.
          </Text>
        }
        contentContainerStyle={{ paddingBottom: 60 }}
      />
    </SafeAreaView>
  );
}
