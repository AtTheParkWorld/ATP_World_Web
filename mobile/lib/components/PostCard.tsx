/**
 * Post card — Feed and post-detail share this component.
 *
 * Lazy interactions:
 *   - Like button: optimistic toggle, rolls back on error
 *   - Tap card body  → /community/post/[id]
 *   - Tap avatar     → /community/members/[id]
 *   - Long-press     → report sheet
 *
 * Comment count + relative time render statelessly.
 */
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Video, ResizeMode } from 'expo-av';
import type { Post } from '@/lib/api/community';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';
import { Avatar } from '@/lib/components/Avatar';

function isVideoMedia(m: { src: string; type?: string }): boolean {
  if (m.type === 'video') return true;
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(m.src);
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
          <Video
            source={{ uri: absUrl(post.media[0].src)! }}
            style={{ width: '100%', aspectRatio: 4 / 3, marginTop: 12, borderRadius: 14, backgroundColor: '#000' }}
            useNativeControls
            resizeMode={ResizeMode.COVER}
            isLooping={false}
          />
        ) : (
          <Image
            source={{ uri: absUrl(post.media[0].src)! }}
            className="w-full mt-3 rounded-atp"
            style={{ aspectRatio: 4 / 3 }}
            resizeMode="cover"
          />
        )
      )}

      {/* Footer */}
      <View className="flex-row items-center gap-5 mt-3 pt-3 border-t border-white/5">
        <Pressable onPress={onLikePress} className="flex-row items-center gap-2 active:opacity-60">
          <Text style={{ fontSize: 16 }}>{post.liked_by_me ? '❤️' : '🤍'}</Text>
          <Text style={{ fontFamily: fontFamily.bodyBold, color: post.liked_by_me ? colors.danger : colors.light }} className="text-sm">
            {post.likes_count}
          </Text>
        </Pressable>
        <View className="flex-row items-center gap-2">
          <Text style={{ fontSize: 16 }}>💬</Text>
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.light }} className="text-sm">
            {post.comments_count}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
