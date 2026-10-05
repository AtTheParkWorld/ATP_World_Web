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
 *
 * Replies (founder 2026-10-05): one level of threading. Tap Reply on a
 * comment → the composer shows "Replying to Name" and the new comment
 * carries parent_id. Replies render indented under their top-level
 * comment; replying to a reply joins the same thread (the server hangs
 * it off the top-level comment) and pre-fills "@Name ".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Pressable, Text, TextInput, View } from 'react-native';
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
import { ActionSheet } from '@/lib/components/ActionSheet';
import { PostCard } from '@/lib/components/PostCard';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { useAuthStore } from '@/lib/stores/auth.store';

interface ThreadRow { comment: Comment; isReply: boolean }

/**
 * Oldest-first flat list → top-level comments, each followed by its
 * replies. A reply is grouped under the top of its parent chain; one
 * whose parent was deleted (hidden by the API) shows as top-level.
 */
function threadComments(list: Comment[]): ThreadRow[] {
  const byId = new Map(list.map((c) => [String(c.id), c]));
  const rootOf = (c: Comment): string => {
    let cur = c;
    for (let i = 0; i < 10 && cur.parent_id != null && byId.has(String(cur.parent_id)); i++) {
      cur = byId.get(String(cur.parent_id))!;
    }
    return String(cur.id);
  };
  const replies = new Map<string, Comment[]>();
  const top: Comment[] = [];
  for (const c of list) {
    const root = rootOf(c);
    if (root === String(c.id)) top.push(c);
    else replies.set(root, [...(replies.get(root) ?? []), c]);
  }
  return top.flatMap((c) => [
    { comment: c, isReply: false },
    ...(replies.get(String(c.id)) ?? []).map((r) => ({ comment: r, isReply: true })),
  ]);
}

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

  const rows = useMemo(() => threadComments(commentsQ.data || []), [commentsQ.data]);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string | number; name: string } | null>(null);
  const inputRef = useRef<TextInput>(null);

  function onReply(c: Comment, isReply: boolean) {
    const first = (c.first_name || '').trim();
    setReplyTo({ id: c.id, name: `${first} ${c.last_name || ''}`.trim() || 'this comment' });
    // Inside a thread every reply sits at the same indent, so say who
    // you're answering.
    if (isReply && first) setDraft((d) => (d.trim() ? d : `@${first} `));
    inputRef.current?.focus();
  }

  const submitCommentMu = useMutation({
    mutationFn: () => createComment(postId, draft.trim(), replyTo?.id),
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ['comments', postId] });
      // Bump the post's comment count optimistically in feed cache.
      qc.setQueryData<Post[] | undefined>(['feed'], (xs) =>
        xs?.map((p) => p.id === postId ? { ...p, comments_count: p.comments_count + 1 } : p)
      );
    },
    onError: (err) => Alert.alert('Could not comment', (err as Error).message || 'Try again.'),
  });

  const deleteCommentMu = useMutation({
    mutationFn: (commentId: string | number) => deleteComment(postId, commentId),
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

  // "⋯" report menu — was a 4-button Alert: Android shows at most three
  // buttons (dropping "Inappropriate") and BACK couldn't dismiss it.
  const [reportOpen, setReportOpen] = useState(false);
  function report(reason: 'spam' | 'harassment' | 'inappropriate') {
    setReportOpen(false);
    reportMu.mutate(reason);
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top', 'bottom']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
          Post
        </Text>
        <Pressable onPress={() => setReportOpen(true)} hitSlop={8} accessibilityLabel="Post options" className="py-2 px-2">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>⋯</Text>
        </Pressable>
      </View>

      {/* behavior="padding" on both platforms — Android is edge-to-edge,
          where the OS no longer shrinks the window for the keyboard, so
          `undefined` left the composer under it (same fix as the DM
          thread, founder 2026-10-05). */}
      <KeyboardAvoidingView behavior="padding" className="flex-1">
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
          data={rows}
          keyExtractor={(r) => String(r.comment.id)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <CommentRow
              comment={item.comment}
              isReply={item.isReply}
              canDelete={me?.id === item.comment.member_id || me?.id === post?.member_id}
              onDelete={() => deleteCommentMu.mutate(item.comment.id)}
              onReply={() => onReply(item.comment, item.isReply)}
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
        {!!replyTo && (
          <View className="px-4 pt-2 flex-row items-center border-t border-white/5">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs flex-1" numberOfLines={1}>
              Replying to <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }}>{replyTo.name}</Text>
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityLabel="Cancel reply" className="px-2 py-1">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-sm">✕</Text>
            </Pressable>
          </View>
        )}
        <View className={`px-3 pb-3 pt-2 flex-row items-end gap-2 ${replyTo ? '' : 'border-t border-white/5'}`}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
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

      <ActionSheet
        visible={reportOpen}
        title="Report this post?"
        message="A moderator will review it within 24 hours."
        actions={[
          { label: 'Spam',          onPress: () => report('spam') },
          { label: 'Harassment',    onPress: () => report('harassment') },
          { label: 'Inappropriate', onPress: () => report('inappropriate') },
        ]}
        onClose={() => setReportOpen(false)}
      />
    </SafeAreaView>
  );
}

function CommentRow({ comment, isReply, canDelete, onDelete, onReply }: {
  comment: Comment;
  isReply: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onReply: () => void;
}) {
  return (
    <View
      className="pr-5 py-3 border-b border-white/5"
      // Replies indent under their comment with a thread line.
      style={isReply
        ? { marginLeft: 36, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: 'rgba(255,255,255,0.08)' }
        : { paddingLeft: 20 }}
    >
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
      <View className="flex-row items-center gap-5 mt-1.5">
        <Pressable onPress={onReply} hitSlop={8} className="active:opacity-60">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
            Reply
          </Text>
        </Pressable>
        {canDelete && (
          <Pressable onPress={onDelete} hitSlop={8} className="active:opacity-60">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-xs uppercase tracking-widest">
              Delete
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
