/**
 * Blocked members list. Tap a row → confirm unblock → row disappears
 * and the relationship is removed (backend will require a fresh
 * friend request if both sides want to reconnect).
 */
import { Alert, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listBlocked, unblockMember } from '@/lib/api/friends';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function BlockedMembers() {
  const qc = useQueryClient();

  const blockedQ = useQuery({ queryKey: ['blocked'], queryFn: () => listBlocked().then(r => r.blocked) });

  const unblockMu = useMutation({
    mutationFn: (id: string) => unblockMember(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blocked'] }),
    onError: (err) => Alert.alert('Could not unblock', (err as Error).message || 'Try again.'),
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Blocked members
        </Text>
      </View>

      <FlatList
        data={blockedQ.data || []}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <View className="mx-5 mt-3 bg-atp-dark border border-white/5 rounded-atp p-3 flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-full bg-atp-dark-3 items-center justify-center overflow-hidden">
              {item.avatar_url
                ? <Image source={{ uri: item.avatar_url }} className="w-10 h-10" />
                : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{item.first_name[0]}</Text>}
            </View>
            <View className="flex-1">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                {item.first_name} {item.last_name}
              </Text>
            </View>
            <Pressable
              onPress={() => Alert.alert(
                'Unblock?',
                "They'll be able to see your posts again. You can re-block any time.",
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Unblock', onPress: () => unblockMu.mutate(item.id) },
                ]
              )}
              className="bg-atp-dark-3 rounded-atp px-3 py-2 active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest">
                Unblock
              </Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
              {blockedQ.isLoading ? 'Loading…' : 'You haven\'t blocked anyone.'}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={blockedQ.isFetching && !blockedQ.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['blocked'] })}
          />
        }
        contentContainerStyle={{ paddingBottom: 60 }}
      />
    </SafeAreaView>
  );
}
