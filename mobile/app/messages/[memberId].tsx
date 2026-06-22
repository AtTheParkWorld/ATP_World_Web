/**
 * 1:1 DM thread. Newest at the bottom (inverted FlatList), composer
 * pinned to the bottom. Read receipts handled server-side — opening
 * the thread already marks incoming messages as read.
 *
 * Polls every 5 seconds while the screen is active so messages
 * arrive without push notifications. Once OneSignal is wired we'll
 * trigger an immediate refetch on push payload.
 */
import { useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getThread, sendMessage, reportMessage } from '@/lib/api/messages';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function DMThread() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const otherId = String(memberId || '');
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const listRef = useRef<FlatList>(null);

  const q = useQuery({
    queryKey: ['thread', otherId],
    queryFn:  () => getThread(otherId).then(r => r.messages),
    enabled:  !!otherId,
    refetchInterval: 5_000,
  });

  const [draft, setDraft] = useState('');
  const sendMu = useMutation({
    mutationFn: () => sendMessage(otherId, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['thread', otherId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => Alert.alert('Could not send', (err as Error).message || 'Try again.'),
  });

  function onLongPress(messageId: string | number, senderId: string) {
    if (senderId === me?.id) return;  // can't report your own message
    Alert.alert(
      'Report this message?',
      'A moderator will review it within 24 hours.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Spam',         onPress: () => reportMessage(messageId, 'spam').then(() => Alert.alert('Reported', 'Thanks.')) },
        { text: 'Harassment',   onPress: () => reportMessage(messageId, 'harassment').then(() => Alert.alert('Reported', 'Thanks.')) },
        { text: 'Inappropriate', onPress: () => reportMessage(messageId, 'inappropriate').then(() => Alert.alert('Reported', 'Thanks.')) },
      ]
    );
  }

  const messages = q.data || [];
  // Reverse for inverted FlatList (newest at bottom visually)
  const reversed = [...messages].reverse();

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/community/members/${otherId}`)} className="flex-row items-center gap-2 ml-2">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
            {messages[0]?.first_name || 'Chat'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <FlatList
          ref={listRef}
          data={reversed}
          inverted
          keyExtractor={(m) => String(m.id)}
          renderItem={({ item }) => {
            const isMine = item.sender_id === me?.id;
            return (
              <Pressable
                onLongPress={() => onLongPress(item.id, item.sender_id)}
                className={`mx-5 my-1 max-w-[80%] px-3.5 py-2.5 rounded-2xl ${isMine ? 'self-end bg-atp-green' : 'self-start bg-atp-dark border border-white/10'}`}
              >
                <Text
                  style={{
                    fontFamily: fontFamily.body,
                    color: isMine ? colors.black : colors.white,
                  }}
                  className="text-base leading-tight"
                >
                  {item.content}
                </Text>
                <Text
                  style={{
                    fontFamily: fontFamily.body,
                    color: isMine ? 'rgba(0,0,0,0.5)' : colors.muted,
                  }}
                  className="text-[10px] mt-1 self-end"
                >
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {isMine && item.read_at ? ' · read' : ''}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View className="px-8 pt-12 items-center">
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
                No messages yet. Say hi.
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingVertical: 12 }}
        />

        <View className="px-3 pb-3 pt-2 border-t border-white/5 flex-row items-end gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message…"
            placeholderTextColor={colors.muted}
            multiline
            className="flex-1 bg-atp-dark border border-white/10 rounded-atp px-3 py-2"
            style={{ fontFamily: fontFamily.body, color: colors.white, maxHeight: 110 }}
          />
          <Pressable
            onPress={() => sendMu.mutate()}
            disabled={!draft.trim() || sendMu.isPending}
            className={`rounded-atp px-4 py-3 ${(!draft.trim() || sendMu.isPending) ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
              Send
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
