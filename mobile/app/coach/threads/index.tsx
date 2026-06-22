/**
 * Coach inquiries list. Visitor → coach DMs (sent via the public
 * "message this coach" form on the web). Coach's mobile dashboard
 * lets them browse + reply on the go.
 */
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyCoachThreads, type CoachThread } from '@/lib/api/coach';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function CoachThreads() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const coachId = String(me?.id || '');

  const q = useQuery({
    queryKey: ['coach-threads', coachId],
    queryFn:  () => listMyCoachThreads(coachId),
    enabled:  !!coachId,
    refetchInterval: 30_000,
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Inquiries
        </Text>
        {!!q.data?.unread_messages && (
          <View className="ml-auto bg-atp-red rounded-full min-w-[22px] h-[22px] items-center justify-center px-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">
              {q.data.unread_messages}
            </Text>
          </View>
        )}
      </View>

      <FlatList
        data={q.data?.threads || []}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <ThreadRow thread={item} />}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['coach-threads', coachId] })}
          />
        }
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
              No inquiries yet. Visitors can message you from your public coach page.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

function ThreadRow({ thread }: { thread: CoachThread }) {
  const unread = thread.coach_unread > 0;
  return (
    <Pressable
      onPress={() => router.push(`/coach/threads/${thread.id}`)}
      className={`mx-5 mt-2 rounded-atp p-3 flex-row items-start gap-3 active:opacity-70 ${unread ? 'bg-atp-green/10 border border-atp-green/40' : 'bg-atp-dark border border-white/5'}`}
    >
      <Text style={{ fontSize: 22 }}>{unread ? '🔵' : '✉️'}</Text>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
            {thread.sender_name}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
            {timeAgo(thread.last_message_at)}
          </Text>
        </View>
        {!!thread.subject && (
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mt-0.5">
            {thread.subject}
          </Text>
        )}
        {!!thread.last_message_preview && (
          <Text
            style={{ fontFamily: fontFamily.body, color: unread ? colors.white : colors.light }}
            className="text-sm mt-1"
            numberOfLines={2}
          >
            {thread.last_message_role === 'coach' ? '↩ ' : ''}{thread.last_message_preview}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
