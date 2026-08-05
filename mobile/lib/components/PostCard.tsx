/**
 * Post card — Feed and post-detail share this component.
 *
 * Lazy interactions:
 *   - Like button: optimistic toggle, rolls back on error
 *   - Tap card body  → /community/post/[id]
 *   - Tap avatar     → /community/members/[id]
 *   - Long-press     → report sheet
 *   - Media posts    → Share (native sheet with the media URL) and
 *                      Save (download to cache → camera roll via
 *                      expo-media-library, write-only permission)
 *
 * Comment count + relative time render statelessly.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
// Lazily required inside onSavePress — expo-media-library is a NATIVE
// module, so a statically-imported reference would crash this whole
// component on any binary built before it was added (e.g. testers still
// on an older OTA-updated build). Loading it on demand lets the rest of
// the card work everywhere and degrades Save gracefully.
type MediaLibraryModule = typeof import('expo-media-library');
function loadMediaLibrary(): MediaLibraryModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-media-library') as MediaLibraryModule;
  } catch {
    return null;
  }
}
import type { Post } from '@/lib/api/community';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';
import { Avatar } from '@/lib/components/Avatar';
import { IconChat, IconDownload, IconHeart, IconShare } from '@/lib/components/icons';

function isVideoMedia(m: { src: string; type?: string }): boolean {
  if (m.type === 'video') return true;
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(m.src);
}

/**
 * Feed video — Instagram-style: autoplays muted + looping the moment
 * it's on screen (FlatList unmounts far-off-screen cards, so at most
 * a couple play concurrently). Tapping toggles sound; a speaker chip
 * bottom-right shows the current state.
 */
function FeedVideo({ uri }: { uri: string }) {
  const [muted, setMuted] = useState(true);
  // expo-video (expo-av was removed from the SDK): the player object
  // owns playback state; autoplay muted + loop reproduces the old
  // Instagram-style behaviour exactly.
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <Pressable onPress={() => { const next = !muted; setMuted(next); player.muted = next; }}>
      <VideoView
        player={player}
        style={{ width: '100%', aspectRatio: 4 / 3, marginTop: 12, borderRadius: 14, backgroundColor: '#000' }}
        contentFit="cover"
        nativeControls={false}
      />
      <View
        style={{
          position: 'absolute', right: 10, bottom: 10,
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
        }}
      >
        <Text style={{ fontSize: 13 }}>{muted ? '🔇' : '🔊'}</Text>
      </View>
    </Pressable>
  );
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)     return `${s}s`;
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  post: Post;
  onPress?: () => void;
  onAvatarPress?: () => void;
  onLikePress?: () => void;
  onLongPress?: () => void;
}

export function PostCard({ post, onPress, onAvatarPress, onLikePress, onLongPress }: Props) {
  const tColor = tribeColor(post.tribe_slug);
  const [saving, setSaving] = useState(false);

  const media0 = (post.media && post.media.length > 0 ? post.media[0] : null) ?? null;
  const mediaUrl = media0?.src ? absUrl(media0.src) : null;

  // TAG A FRIEND — "with @Name" line when the poster tagged friends.
  const taggedNames = (post.tagged_members ?? [])
    .map((t) => `@${`${t.first_name ?? ''} ${t.last_name ?? ''}`.trim() || 'a friend'}`)
    .join(', ');

  async function onSharePress() {
    if (!mediaUrl) return;
    try {
      // iOS shares a real URL object; Android's sheet only reads message.
      await Share.share(Platform.OS === 'ios' ? { url: mediaUrl } : { message: mediaUrl });
    } catch {
      // Member dismissed the sheet — nothing to surface.
    }
  }

  async function onSavePress() {
    if (!mediaUrl || !media0 || saving) return;
    setSaving(true);
    try {
      const MediaLibrary = loadMediaLibrary();
      if (!MediaLibrary) {
        Alert.alert('Update needed', 'Saving to your camera roll arrives in the next app update.');
        return;
      }
      // writeOnly — we only ever ADD to the camera roll, never read it.
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert(
          'Allow photo access',
          'To save this to your camera roll, allow photo access for ATP in Settings.',
        );
        return;
      }
      const isVideo = isVideoMedia(media0);
      const target = `${FileSystem.cacheDirectory}atp-post-${String(post.id)}${isVideo ? '.mp4' : '.jpg'}`;
      const dl = await FileSystem.downloadAsync(mediaUrl, target);
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      Alert.alert('Saved 💚', isVideo ? 'Video saved to your camera roll.' : 'Photo saved to your camera roll.');
    } catch (err) {
      Alert.alert('Could not save', (err as Error).message || 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Pressable
      onPress={onPress || (() => router.push(`/community/post/${post.id}`))}
      onLongPress={onLongPress}
      className="bg-atp-dark rounded-atp-lg border border-white/5 p-4 active:opacity-80"
    >
      {/* Author row */}
      <View className="flex-row items-center gap-3">
        <Pressable onPress={onAvatarPress || (() => router.push(`/community/members/${post.member_id}`))}>
          <Avatar
            uri={post.avatar_url}
            firstName={post.first_name}
            lastName={post.last_name}
            id={post.member_id}
            size={40}
            borderColor={tColor}
            borderWidth={1}
          />
        </Pressable>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
              {post.first_name} {post.last_name}
            </Text>
            {post.is_ambassador && (
              <View className="bg-atp-green/15 border border-atp-green/40 px-2 py-0.5 rounded-full">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[10px] uppercase tracking-widest">
                  AMB
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center gap-2 mt-0.5">
            {!!post.tribe_name && (
              <Text style={{ fontFamily: fontFamily.bodyBold, color: tColor }} className="text-[10px] uppercase tracking-widest">
                {post.tribe_name}
              </Text>
            )}
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
              {timeAgo(post.created_at)}
            </Text>
          </View>
        </View>
      </View>

      {/* Tagged friends — "with @Name" */}
      {!!taggedNames && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-2">
          with <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }}>{taggedNames}</Text>
        </Text>
      )}

      {/* Content */}
      {!!post.content && (
        <Text
          style={{ fontFamily: fontFamily.body, color: colors.white }}
          className="text-base leading-relaxed mt-3"
        >
          {post.content}
        </Text>
      )}

      {/* Media (first only) — backend serves URL under `src`. Detect
          video vs image by `type` first, then by file extension. */}
      {!!post.media && post.media.length > 0 && !!post.media[0]?.src && (
        isVideoMedia(post.media[0]) ? (
          <FeedVideo uri={absUrl(post.media[0].src)!} />
        ) : (
          <Image
            source={{ uri: absUrl(post.media[0].src)! }}
            className="w-full mt-3 rounded-atp"
            style={{ aspectRatio: 4 / 3 }}
            resizeMode="cover"
          />
        )
      )}

      {/* Footer — one consistent action row. Every action uses the
          in-app icon system at the same 18px / stroke 2, muted when
          inactive; the heart goes danger-red + beats when liked. */}
      <View className="flex-row items-center gap-5 mt-3 pt-3 border-t border-white/5">
        <Pressable onPress={onLikePress} hitSlop={8} className="flex-row items-center gap-1.5 active:opacity-60">
          <IconHeart
            size={18}
            strokeWidth={2}
            color={post.liked_by_me ? colors.danger : colors.muted}
            active={!!post.liked_by_me}
          />
          <Text style={{ fontFamily: fontFamily.bodyBold, color: post.liked_by_me ? colors.danger : colors.muted }} className="text-xs">
            {post.likes_count}
          </Text>
        </Pressable>
        <View className="flex-row items-center gap-1.5">
          <IconChat size={18} strokeWidth={2} color={colors.muted} />
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs">
            {post.comments_count}
          </Text>
        </View>

        {/* Media-only actions — kept muted so they read as secondary. */}
        {!!mediaUrl && (
          <View className="flex-row items-center gap-4 ml-auto">
            <Pressable onPress={onSharePress} hitSlop={8} className="flex-row items-center gap-1.5 active:opacity-60">
              <IconShare size={18} strokeWidth={2} color={colors.muted} />
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs">
                Share
              </Text>
            </Pressable>
            <Pressable onPress={onSavePress} disabled={saving} hitSlop={8} className="flex-row items-center gap-1.5 active:opacity-60">
              {saving
                ? <ActivityIndicator size="small" color={colors.muted} />
                : <IconDownload size={18} strokeWidth={2} color={colors.muted} />}
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs">
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Pressable>
  );
}
