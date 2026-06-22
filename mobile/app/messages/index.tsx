/**
 * Conversations list — last message + unread badge per friend.
 * Tap a row → /messages/[memberId] for the thread.
 *
 * Pull-to-refresh re-queries; pushes from OneSignal (Phase 8) will
 * also invalidate this query when they land.
 */
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations } from '@/lib/api/messages';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function MessagesIndex() {
  const qc = useQueryClient();
  const q  = useQuery({
    queryKey: ['conversations'],
    queryFn:  () => listConversations().then(r => r.conversations),
    refetchInterval: 30_000,   // poll every 30s in foreground
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Messages
        </Text>
      </View>

      <FlatList
        data={q.data || []}
        keyExtractor={(c) => String(c.id)}
        renderItem={({ item }) => {
          const unread = Number(item.unread_count) || 0;
          return (
            <Pressable
              onPress={() => router.push(`/messages/${item.other_id}`)}
              className="mx-5 mt-2 bg-atp-dark border border-white/5 rounded-atp p-3 flex-row items-center gap-3 active:opacity-70"
            >
              <View className="w-12 h-12 rounded-full bg-atp-dark-3 overflow-hidden items-center justify-center">
                {item.other_avatar
                  ? <Image source={{ uri: absUrl(item.other_avatar)! }} className="w-12 h-12" />
                  : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{item.other_first[0]}</Text>}
              </View>
              <View className="flex-1">
                <View className="flex-row items-center justify-between">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                    {item.other_first} {item.other_last}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                    {timeAgo(item.last_message_at)}
                  </Text>
                </View>
                {!!item.last_message && (
                  <Text
                    style={{ fontFamily: fontFamily.body, color: unread > 0 ? colors.white : colors.light }}
                    className="text-sm mt-0.5"
                    numberOfLines={1}
                  >
                    {item.last_message}
                  </Text>
                )}
              </View>
              {unread > 0 && (
                <View className="bg-atp-green rounded-full min-w-[22px] h-[22px] items-center justify-center px-2">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs">
                    {unread}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        }}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['conversations'] })}
          />
        }
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
              No messages yet. Open any friend's profile and tap Message to start a chat.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}
