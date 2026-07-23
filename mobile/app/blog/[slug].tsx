import { WEB_BASE } from '@/lib/api/client';
/**
 * Blog post detail. Renders the post body as preformatted text — most
 * ATP blog content is markdown-flavoured prose, which reads fine in a
 * monospaced fallback. Future polish: install react-native-render-html
 * to support full rich rendering with images + links.
 */
import { Image, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getPost } from '@/lib/api/blog';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function BlogPostScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const q = useQuery({
    queryKey: ['blog-post', slug],
    queryFn:  () => getPost(String(slug)),
    enabled:  !!slug,
  });

  const post    = q.data?.post;
  const related = q.data?.related || [];
  const hero    = absUrl(post?.hero_image_url || post?.cover_image_url);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center justify-between border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        {!!post && (
          <Pressable
            onPress={() => Share.share({
              message: post.title,
              url:     `${WEB_BASE}/blog/${post.slug}`,
            })}
            className="py-2 px-2"
          >
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">Share</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {!!hero && (
          <Image source={{ uri: hero }} style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.dark2 }} resizeMode="cover" />
        )}

        <View className="px-5 mt-5">
          {!!post?.category && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-2">
              {post.category}
            </Text>
          )}
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight">
            {post?.title || ' '}
          </Text>
          {!!post?.subtitle && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-2 leading-relaxed">
              {post.subtitle}
            </Text>
          )}
          <View className="flex-row items-center gap-2 mt-3 mb-5">
            {!!post?.author_name && (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                By {post.author_name}
              </Text>
            )}
            {!!post?.reading_time_mins && (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                · {post.reading_time_mins} min read
              </Text>
            )}
            {!!post?.published_at && (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                · {new Date(post.published_at).toLocaleDateString()}
              </Text>
            )}
          </View>

          {!!post?.body && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-base leading-relaxed">
              {post.body}
            </Text>
          )}
        </View>

        {related.length > 0 && (
          <View className="px-5 mt-10">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
              Related stories
            </Text>
            {related.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/blog/${r.slug}`)}
                className="bg-atp-dark border border-white/5 rounded-atp p-4 mb-2 active:opacity-70"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={2}>
                  {r.title}
                </Text>
                {!!r.excerpt && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1" numberOfLines={2}>
                    {r.excerpt}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
