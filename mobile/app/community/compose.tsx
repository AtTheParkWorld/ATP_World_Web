/**
 * Post composer. 500-char cap (matches R-PO-002 / backend), counter
 * turns red when over budget. Photo attachment is out of scope for
 * this phase — the post API accepts media[] but the upload flow
 * (R2 signed PUT) lives in Phase 6/7.
 */
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPost } from '@/lib/api/community';
import { ApiError } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';

const MAX = 500;

export default function Compose() {
  const qc = useQueryClient();
  const [content, setContent] = useState('');
  const remaining = MAX - content.length;

  const submitMu = useMutation({
    mutationFn: () => createPost(content),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.code === 'POST_BLOCKED')      Alert.alert('Post blocked', 'Your post contains content that violates community guidelines.');
        else if (err.code === 'POST_RATE_LIMIT') Alert.alert('Slow down', err.message);
        else if (err.code === 'POST_TOO_LONG')   Alert.alert('Too long', `Max ${MAX} characters.`);
        else Alert.alert('Could not post', err.message);
      } else {
        Alert.alert('Could not post', (err as Error).message || 'Try again.');
      }
    },
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-white/5">
          <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>Cancel</Text>
          </Pressable>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
            New post
          </Text>
          <Pressable
            onPress={() => submitMu.mutate()}
            disabled={!content.trim() || remaining < 0 || submitMu.isPending}
            className={`px-4 py-2 rounded-atp ${(!content.trim() || remaining < 0 || submitMu.isPending) ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
              {submitMu.isPending ? 'Posting…' : 'Post'}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="What's on your mind?"
            placeholderTextColor={colors.muted}
            multiline
            autoFocus
            style={{
              fontFamily: fontFamily.body,
              color: colors.white,
              fontSize: 17,
              lineHeight: 24,
              minHeight: 160,
            }}
          />
        </ScrollView>

        <View className="px-5 pb-4 border-t border-white/5 pt-3 flex-row items-center justify-between">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
            Be kind. Posts may be moderated.
          </Text>
          <Text
            style={{
              fontFamily: fontFamily.bodyBold,
              color: remaining < 0 ? colors.danger : remaining < 40 ? colors.warning : colors.muted,
            }}
            className="text-xs"
          >
            {remaining}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
