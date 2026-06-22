/**
 * Challenges list. Shows active challenges with current participants
 * + the viewer's progress + a Join button if not yet joined. Tap a
 * card → /challenges/[id] for the detail + leaderboard.
 */
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listChallenges, type Challenge } from '@/lib/api/challenges';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function ChallengesIndex() {
  const qc = useQueryClient();
  const q  = useQuery({ queryKey: ['challenges'], queryFn: () => listChallenges().then(r => r.challenges) });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Challenges
        </Text>
      </View>

      <FlatList
        data={q.data || []}
        keyExtractor={(c) => String(c.id)}
        renderItem={({ item }) => <ChallengeCard challenge={item} />}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['challenges'] })}
          />
        }
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            {q.isLoading
              ? <ActivityIndicator color={colors.green} />
              : <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
                  No active challenges right now. New ones drop monthly.
                </Text>}
          </View>
        }
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const myProgress = Number(challenge.my_progress) || 0;
  const pct = challenge.target > 0 ? Math.min(100, Math.round((myProgress / challenge.target) * 100)) : 0;
  const daysLeft = Math.max(0, Math.ceil((new Date(challenge.ends_at).getTime() - Date.now()) / 86_400_000));

  return (
    <Pressable
      onPress={() => router.push(`/challenges/${challenge.id}`)}
      className="mx-5 mb-3 bg-atp-dark rounded-atp-lg border border-white/5 overflow-hidden active:opacity-70"
    >
      {!!challenge.cover_image_url && (
        <Image
          source={{ uri: absUrl(challenge.cover_image_url)! }}
          className="w-full"
          style={{ aspectRatio: 16 / 9, backgroundColor: colors.dark2 }}
          resizeMode="cover"
        />
      )}
      <View className="p-4">
        <View className="flex-row items-center gap-2 mb-1">
          {challenge.joined && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
              ✓ Joined
            </Text>
          )}
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
            {challenge.participant_count} joined · {daysLeft}d left
          </Text>
        </View>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase tracking-tight">
          {challenge.title}
        </Text>
        {!!challenge.description && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1 leading-relaxed" numberOfLines={2}>
            {challenge.description}
          </Text>
        )}

        {challenge.joined && (
          <View className="mt-3">
            <View className="h-1.5 bg-atp-dark-3 rounded-full overflow-hidden">
              <View className="h-full bg-atp-green" style={{ width: `${pct}%` }} />
            </View>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
              {myProgress.toLocaleString()} / {challenge.target.toLocaleString()} {challenge.unit || ''} ({pct}%)
            </Text>
          </View>
        )}

        <View className="flex-row items-center gap-3 mt-3">
          {challenge.reward_points && challenge.reward_points > 0 && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">
              +{challenge.reward_points} pts
            </Text>
          )}
          {!!challenge.city_name && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
              📍 {challenge.city_name}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
