/**
 * Blog index — published posts in reverse-chronological order with
 * optional category filter. Top hero card (most recent) + grid of
 * smaller cards beneath. Mirrors the web's /blog page.
 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listPosts, listCategories, type BlogPost } from '@/lib/api/blog';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function BlogIndex() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<string | null>(null);

  const postsQ = useQuery({
    queryKey: ['blog', category],
    queryFn:  () => listPosts({ limit: 30, category: category ?? undefined }).then(r => r.posts),
  });
  const catsQ = useQuery({
    queryKey: ['blog-categories'],
    queryFn:  () => listCategories().then(r => r.categories),
    staleTime: 1000 * 60 * 10,
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Stories
        </Text>
      </View>

      <FlatList
        data={postsQ.data || []}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={
          <View className="px-3 pt-3 pb-2 flex-row flex-wrap gap-2">
            <CatPill label="All" active={!category} onPress={() => setCategory(null)} />
            {(catsQ.data || []).map((c) => (
              <CatPill key={c.category} label={c.category} active={category === c.category} onPress={() => setCategory(c.category)} />
            ))}
          </View>
        }
        renderItem={({ item, index }) => <PostCard post={item} hero={index === 0 && !category} />}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={postsQ.isFetching && !postsQ.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['blog'] })}
          />
        }
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            {postsQ.isLoading
              ? <ActivityIndicator color={colors.green} />
              : <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
                  No posts yet. Check back soon.
                </Text>}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

function CatPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1.5 border ${active ? 'bg-atp-green border-atp-green' : 'bg-atp-dark border-white/10'}`}
    >
      <Text
        style={{ fontFamily: fontFamily.bodyBold, color: active ? colors.black : colors.white }}
        className="text-xs uppercase tracking-widest"
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PostCard({ post, hero }: { post: BlogPost; hero?: boolean }) {
  const img = absUrl(post.cover_image_url || post.hero_image_url);
  return (
    <Pressable
      onPress={() => router.push(`/blog/${post.slug}`)}
      className="mx-5 mt-3 bg-atp-dark rounded-atp-lg border border-white/5 overflow-hidden active:opacity-70"
    >
      {!!img && (
        <Image
          source={{ uri: img }}
          className="w-full"
          style={{ aspectRatio: hero ? 16 / 9 : 4 / 3, backgroundColor: colors.dark2 }}
          resizeMode="cover"
        />
      )}
      <View className="p-4">
        {!!post.category && (
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-1">
            {post.category}
          </Text>
        )}
        <Text
          style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
          className={`uppercase tracking-tight ${hero ? 'text-2xl' : 'text-lg'}`}
        >
          {post.title}
        </Text>
        {!!post.excerpt && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2 leading-relaxed" numberOfLines={hero ? 3 : 2}>
            {post.excerpt}
          </Text>
        )}
        <View className="flex-row items-center gap-2 mt-3">
          {!!post.author_name && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
              By {post.author_name}
            </Text>
          )}
          {!!post.reading_time_mins && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
              · {post.reading_time_mins} min read
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
