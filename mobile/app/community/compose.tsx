/**
 * Post composer with media attach.
 *
 * Text: 500-char cap (R-PO-002), counter turns warning/danger as you
 * approach the limit. Posts with only media + no text are allowed.
 *
 * Media: tap the 📷 button → expo-image-picker library sheet → pick
 * one item → uploaded straight to R2 via /cms/upload-url (signed PUT,
 * never touches our Render dyno's request body). The resulting
 * public_url is passed in the post's `media` array.
 *
 * Single attachment per post for v1 — Rulebook caps at 4 but multi-
 * upload UI is a follow-up; this matches the existing web composer.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPost } from '@/lib/api/community';
import { listFriends, type Friendship } from '@/lib/api/friends';
import { pickAndUploadMedia } from '@/lib/api/upload';
import { ApiError } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';

const MAX = 500;
const MAX_TAGS = 10;  // matches the backend's tagged_member_ids cap

interface Attachment {
  url:  string;
  type: string;  // mime
}

export default function Compose() {
  const qc = useQueryClient();
  const [content, setContent]   = useState('');
  const [media, setMedia]       = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [tagged, setTagged]     = useState<string[]>([]);
  const remaining = MAX - content.length;
  const canSubmit = !!content.trim() || media.length > 0;

  // TAG A FRIEND — accepted friends load lazily the first time the
  // picker opens; chips multi-select up to MAX_TAGS.
  const friendsQ = useQuery({
    queryKey: ['friends'],
    queryFn:  listFriends,
    enabled:  showTags,
  });
  const acceptedFriends: Friendship[] =
    (friendsQ.data?.friendships ?? []).filter((f: Friendship) => f.status === 'accepted');

  function toggleTag(id: string) {
    setTagged((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_TAGS) {
        Alert.alert('Tag limit', `You can tag up to ${MAX_TAGS} friends per post.`);
        return cur;
      }
      return [...cur, id];
    });
  }

  const submitMu = useMutation({
    mutationFn: () => createPost(content, media.map((m) => ({ src: m.url, type: m.type })), tagged),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.code === 'POST_BLOCKED')         Alert.alert('Post blocked', 'Your post contains content that violates community guidelines.');
        else if (err.code === 'POST_RATE_LIMIT') Alert.alert('Slow down', err.message);
        else if (err.code === 'POST_TOO_LONG')   Alert.alert('Too long', `Max ${MAX} characters.`);
        else Alert.alert('Could not post', err.message);
      } else {
        Alert.alert('Could not post', (err as Error).message || 'Try again.');
      }
    },
  });

  async function onAttachPress() {
    if (media.length >= 1) {
      Alert.alert('One attachment only', 'Remove the current photo first to attach a different one.');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await pickAndUploadMedia({ kind: 'post' });
      if (uploaded) {
        setMedia([{ url: uploaded.public_url, type: uploaded.content_type }]);
      }
    } catch (err) {
      Alert.alert('Could not attach', (err as Error).message || 'Try again.');
    } finally {
      setUploading(false);
    }
  }

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
            disabled={!canSubmit || remaining < 0 || submitMu.isPending || uploading}
            className={`px-4 py-2 rounded-atp ${(!canSubmit || remaining < 0 || submitMu.isPending || uploading) ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
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
              minHeight: 140,
            }}
          />

          {/* Attachment preview */}
          {media.length > 0 && (
            <View className="mt-4 relative">
              <Image
                source={{ uri: media[0]?.url }}
                className="w-full rounded-atp"
                style={{ aspectRatio: 4 / 3, backgroundColor: colors.dark2 }}
                resizeMode="cover"
              />
              <Pressable
                onPress={() => setMedia([])}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 items-center justify-center active:opacity-70"
              >
                <Text style={{ color: colors.white, fontSize: 16, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </View>
          )}

          {/* Tag friends */}
          <Pressable onPress={() => setShowTags((v) => !v)} className="mt-5 flex-row items-center gap-2 active:opacity-60">
            <Text style={{ fontSize: 18 }}>🏷️</Text>
            <Text
              style={{ fontFamily: fontFamily.bodyBold, color: tagged.length ? colors.green : colors.muted }}
              className="text-xs uppercase tracking-widest"
            >
              {tagged.length
                ? `Tagged ${tagged.length} friend${tagged.length > 1 ? 's' : ''}`
                : 'Tag friends'}
            </Text>
          </Pressable>
          {showTags && (
            <View className="mt-3 flex-row flex-wrap gap-2">
              {friendsQ.isLoading && <ActivityIndicator color={colors.green} />}
              {!friendsQ.isLoading && acceptedFriends.length === 0 && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                  No accepted friends yet — add friends in the community to tag them.
                </Text>
              )}
              {acceptedFriends.map((f) => {
                const sel = tagged.includes(f.friend_id);
                return (
                  <Pressable
                    key={f.friend_id}
                    onPress={() => toggleTag(f.friend_id)}
                    className={`px-3 py-1.5 rounded-full border ${sel ? 'border-atp-green bg-atp-green/10' : 'border-white/15'} active:opacity-70`}
                  >
                    <Text
                      style={{ fontFamily: fontFamily.bodyBold, color: sel ? colors.green : colors.light }}
                      className="text-xs"
                    >
                      {sel ? '✓ ' : ''}{`${f.first_name ?? ''} ${f.last_name ?? ''}`.trim() || 'Member'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Footer — attach button + char counter */}
        <View className="px-5 pb-4 border-t border-white/5 pt-3 flex-row items-center justify-between">
          <Pressable
            onPress={onAttachPress}
            disabled={uploading}
            className="flex-row items-center gap-2 active:opacity-60"
          >
            {uploading
              ? <ActivityIndicator color={colors.green} />
              : <Text style={{ fontSize: 22 }}>📷</Text>}
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
              {uploading ? 'Uploading…' : media.length > 0 ? 'Photo attached' : 'Add photo / video'}
            </Text>
          </Pressable>
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
