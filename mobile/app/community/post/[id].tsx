/**
 * Single post + comments thread.
 *
 * State:
 *   - Top: PostCard re-uses the same component used in the feed
 *   - Bottom: comments list (oldest first) + sticky composer
 *
 * Comments load lazily; the post itself is hydrated from the feed
 * cache if we have it, otherwise refetched from /community/posts/:id
 * (which doesn't exist as a single-post endpoint — we rely on the
 * feed cache for the post object).
 *
 * If a deep-link lands here without a feed cache hit, we still show
 * the comments thread; the screen header just shows a stub.
 */
import { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getComments,
  createComment,
  deleteComment,
  reportPost,
  toggleLike,
  type Post,
  type Comment,
} from '@/lib/api/community';
import { PostCard } from '@/lib/components/PostCard';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { useAuthStore } from '@/lib/stores/auth.store';

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = String(id || '');
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member);

  // Pull the post object from any cached feed (no single-post endpoint).
  const [post, setPost] = useState<Post | null>(null);
  useEffect(() => {
    const fromCache: Post | undefined = (qc.getQueryData<Post[]>(['feed']) || [])
      .find((p) => p.id === postId)
      || (qc.getQueryData<Post[]>(['me-posts']) || []).find((p) => p.id === postId);
    if (fromCache) setPost(fromCache);
  }, [qc, postId]);

  const commentsQ = useQuery({
    queryKey: ['comments', postId],
    queryFn:  () => getComments(postId).then(r => r.comments),
    enabled:  !!postId,
  });

  const [draft, setDraft] = useState('');
  const submitCommentMu = useMutation({
    mutationFn: () => createComment(postId, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['comments', postId] });
      // Bump the post's comment count optimistically in feed cache.
      qc.setQueryData<Post[] | undefined>(['feed'], (xs) =>
        xs?.map((p) => p.id === postId ? { ...p, comments_count: p.comments_count + 1 } : p)
      );
    },
    onError: (err) => Alert.alert('Could not comment', (err as Error).message || 'Try again.'),
  });

  const deleteCommentMu = useMutation({
    mutationFn: (commentId: number) => deleteComment(postId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments', postId] }),
  });

  const reportMu = useMutation({
    mutationFn: (reason: string) => reportPost(postId, reason),
    onSuccess: () => Alert.alert('Reported', 'Thanks. Our moderators will review.'),
    onError: (err) => Alert.alert('Report failed', (err as Error).message || 'Try again.'),
  });

  const likeMu = useMutation({
    mutationFn: () => toggleLike(postId),
    onSuccess: (res) => {
      // Backend returns { liked } only — derive count from current value.
      setPost((p) => p
        ? { ...p, liked_by_me: res.liked, likes_count: p.likes_count + (res.liked ? 1 : -1) }
        : p);
      qc.setQueryData<Post[] | undefined>(['feed'], (xs) =>
        xs?.map((p) => p.id === postId
          ? { ...p, liked_by_me: res.liked, likes_count: p.likes_count + (res.liked ? 1 : -1) }
          : p)
      );
    },
  });

  function onReportPress() {
    Alert.alert(
      'Report this post?',
      'A moderator will review it within 24 hours.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Spam',         onPress: () => reportMu.mutate('spam') },
        { text: 'Harassment',   onPress: () => reportMu.mutate('harassment') },
        { text: 'Inappropriate', onPress: () => reportMu.mutate('inappropriate') },
      ]
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
          Post
        </Text>
        <Pressable onPress={onReportPress} className="py-2 px-2">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>⋯</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <FlatList
          ListHeaderComponent={
            <View className="px-5 pt-3 pb-2">
              {post ? (
                <PostCard post={post} onLikePress={() => likeMu.mutate()} onPress={() => {}} />
              ) : (
                <View className="bg-atp-dark border border-white/5 rounded-atp p-4">
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                    Post not loaded. Pull to refresh after returning to Feed.
                  </Text>
                </View>
              )}
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mt-5 mb-1">
                Comments
              </Text>
            </View>
          }
          data={commentsQ.data || []}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <CommentRow
              comment={item}
              canDelete={me?.id === item.member_id || me?.id === post?.member_id}
              onDelete={() => deleteCommentMu.mutate(item.id)}
            />
          )}
          ListEmptyComponent={
            <View className="px-5 pt-6 pb-2">
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                {commentsQ.isLoading ? 'Loading…' : 'No comments yet. Be the first.'}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 12 }}
        />

        {/* Composer */}
        <View className="px-3 pb-3 pt-2 border-t border-white/5 flex-row items-end gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment…"
            placeholderTextColor={colors.muted}
            multiline
            className="flex-1 bg-atp-dark border border-white/10 rounded-atp px-3 py-2"
            style={{ fontFamily: fontFamily.body, color: colors.white, maxHeight: 110 }}
          />
          <Pressable
            onPress={() => submitCommentMu.mutate()}
            disabled={!draft.trim() || submitCommentMu.isPending}
            className={`rounded-atp px-4 py-3 ${(!draft.trim() || submitCommentMu.isPending) ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
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

function CommentRow({ comment, canDelete, onDelete }: { comment: Comment; canDelete: boolean; onDelete: () => void }) {
  return (
    <View className="px-5 py-3 border-b border-white/5">
      <View className="flex-row items-center gap-2">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
          {comment.first_name} {comment.last_name}
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
          {new Date(comment.created_at).toLocaleString()}
        </Text>
      </View>
      <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1 leading-relaxed">
        {comment.content}
      </Text>
      {canDelete && (
        <Pressable onPress={onDelete} className="self-start mt-1.5">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-xs uppercase tracking-widest">
            Delete
          </Text>
        </Pressable>
      )}
    </View>
  );
}
