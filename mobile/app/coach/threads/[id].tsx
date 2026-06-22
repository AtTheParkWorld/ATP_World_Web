/**
 * Coach thread detail + reply. Shows the inquiry trail with the
 * visitor's contact info up top so the coach can decide whether to
 * reply in-app or pick up the phone.
 */
import { useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCoachThread, replyToCoachThread } from '@/lib/api/coach';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function CoachThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = String(id || '');
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const coachId = String(me?.id || '');

  const q = useQuery({
    queryKey: ['coach-thread', coachId, threadId],
    queryFn:  () => getCoachThread(coachId, threadId),
    enabled:  !!coachId && !!threadId,
    refetchInterval: 15_000,
  });

  const [draft, setDraft] = useState('');
  const replyMu = useMutation({
    mutationFn: () => replyToCoachThread(coachId, threadId, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['coach-thread', coachId, threadId] });
      qc.invalidateQueries({ queryKey: ['coach-threads', coachId] });
    },
    onError: (err) => Alert.alert('Could not reply', (err as Error).message || 'Try again.'),
  });

  const thread   = q.data?.thread;
  const messages = q.data?.messages || [];

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <View className="ml-2 flex-1">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase" numberOfLines={1}>
            {thread?.sender_name || 'Inquiry'}
          </Text>
          {!!thread?.subject && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs" numberOfLines={1}>
              {thread.subject}
            </Text>
          )}
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        {/* Contact pill row */}
        {!!thread && (
          <View className="flex-row gap-2 px-3 py-3 border-b border-white/5">
            <Pressable
              onPress={() => Linking.openURL(`mailto:${thread.sender_email}`)}
              className="bg-atp-dark border border-white/10 rounded-atp px-3 py-1.5"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
                ✉️ {thread.sender_email}
              </Text>
            </Pressable>
            {!!thread.sender_phone && (
              <Pressable
                onPress={() => Linking.openURL(`tel:${thread.sender_phone}`)}
                className="bg-atp-dark border border-white/10 rounded-atp px-3 py-1.5"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
                  📞 Call
                </Text>
              </Pressable>
            )}
          </View>
        )}

        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            const isMine = item.from_role === 'coach';
            return (
              <View className={`mx-5 my-1 max-w-[80%] px-3.5 py-2.5 rounded-2xl ${isMine ? 'self-end bg-atp-green' : 'self-start bg-atp-dark border border-white/10'}`}>
                <Text
                  style={{ fontFamily: fontFamily.body, color: isMine ? colors.black : colors.white }}
                  className="text-base leading-tight"
                >
                  {item.message}
                </Text>
                <Text
                  style={{ fontFamily: fontFamily.body, color: isMine ? 'rgba(0,0,0,0.5)' : colors.muted }}
                  className="text-[10px] mt-1 self-end"
                >
                  {new Date(item.created_at).toLocaleString()}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="px-8 text-sm text-center pt-6">
              No messages yet.
            </Text>
          }
          contentContainerStyle={{ paddingVertical: 12 }}
        />

        {!thread?.is_closed && (
          <View className="px-3 pb-3 pt-2 border-t border-white/5 flex-row items-end gap-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Reply to this inquiry…"
              placeholderTextColor={colors.muted}
              multiline
              className="flex-1 bg-atp-dark border border-white/10 rounded-atp px-3 py-2"
              style={{ fontFamily: fontFamily.body, color: colors.white, maxHeight: 110 }}
            />
            <Pressable
              onPress={() => replyMu.mutate()}
              disabled={!draft.trim() || replyMu.isPending}
              className={`rounded-atp px-4 py-3 ${(!draft.trim() || replyMu.isPending) ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                Send
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
