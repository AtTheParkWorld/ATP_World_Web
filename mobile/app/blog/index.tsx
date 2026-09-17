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
import { getBlogHero } from '@/lib/api/cms';
import { colors, fontFamily } from '@/lib/theme/tokens';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Rect } from 'react-native-svg';
import { absUrl } from '@/lib/utils/imageUrl';

export default function BlogIndex() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<string | null>(null);

  const postsQ = useQuery({
    queryKey: ['blog', category],
    queryFn:  () => listPosts({ limit: 30, category: category ?? undefined }).then(r => r.posts),
  });
  const heroQ = useQuery({
    queryKey: ['blog-hero'],
    queryFn:  getBlogHero,
    staleTime: 1000 * 60 * 10,
  });
  const posts = postsQ.data || [];
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
          Blog
        </Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={
          <>
            {!!heroQ.data && (() => {
              // Same copy the website hero shows (admin → CMS → Blog Page;
              // founder 2026-08-30: uniform "The ATP Journal / Beyond the
              // workout" on both surfaces). <accent>word</accent> = green.
              const m = /^(.*?)<accent>(.+?)<\/accent>(.*)$/i.exec(heroQ.data.title);
              return (
                <View className="px-5 pt-5 pb-1">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                    {heroQ.data.eyebrow}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight mt-1">
                    {m ? (
                      <>
                        {m[1]}
                        <Text style={{ color: colors.green }}>{m[2]}</Text>
                        {m[3]}
                      </>
                    ) : heroQ.data.title}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-2 leading-relaxed">
                    {heroQ.data.sub}
                  </Text>
                </View>
              );
            })()}
            <View className="px-3 pt-3 pb-2 flex-row flex-wrap gap-2">
              <CatPill label="All" active={!category} onPress={() => setCategory(null)} />
              {(catsQ.data || []).map((c) => (
                <CatPill key={c.category} label={c.category} active={category === c.category} onPress={() => setCategory(c.category)} />
              ))}
            </View>
          </>
        }
        renderItem={({ item, index }) => {
          // Solid fallback alternates across the imageless posts only, so
          // lime and dark truly interleave — same rule as the website.
          const solid: 'lime' | 'dark' =
            (posts.slice(0, index).filter((p) => !p.cover_image_url && !p.hero_image_url).length % 2 === 0)
              ? 'lime' : 'dark';
          return (
            <>
              <PostTile post={item} hero={index === 0 && !category} solid={solid} />
              {/* A statement band every 5 posts, matching the web rhythm. */}
              {(index + 1) % 5 === 0 && index + 1 < posts.length && (
                <StatementBand idx={Math.floor(index / 5)} />
              )}
            </>
          );
        }}
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

/* ── Mosaic tiles ────────────────────────────────────────────────
   Matches the website's Journal layout (founder 2026-09-18: "same look
   and feel"). At phone width the web mosaic stacks into full-width
   tiles of varying treatment, so that's what we build here:

     · photo tiles — artwork full-bleed, scrim, text overlaid
     · lime / dark tiles — for posts with no cover image
     · a lime square marker on every tile
     · full-width lime statement bands between batches

   Cover artwork always wins; only imageless posts become solid blocks,
   alternating lime/dark so two never sit together. Same rule as web. */

const STATEMENTS = [
  { line: 'Never train', accent: 'alone.', sub: 'Free sessions, every day, across the UAE.' },
  { line: 'Beyond the',  accent: 'workout.', sub: 'Coaching, community, and what happens after.' },
];

function Marker({ dark }: { dark?: boolean }) {
  return (
    <View
      style={{
        position: 'absolute', top: 14, left: 14, width: 9, height: 9,
        backgroundColor: dark ? colors.black : colors.green, zIndex: 3,
      }}
    />
  );
}

function StatementBand({ idx }: { idx: number }) {
  const st = STATEMENTS[idx % STATEMENTS.length] ?? STATEMENTS[0]!;
  return (
    <View className="mx-5 mt-3 rounded-atp-lg overflow-hidden" style={{ backgroundColor: colors.green }}>
      <Marker dark />
      <View className="px-6 py-8 items-center">
        <Text
          style={{ fontFamily: fontFamily.displayBlack, color: colors.black }}
          className="text-3xl uppercase tracking-tight text-center"
        >
          {st.line} {st.accent}
        </Text>
        <Text
          style={{ fontFamily: fontFamily.bodyBold, color: 'rgba(10,10,10,0.66)' }}
          className="text-xs mt-2 text-center"
        >
          {st.sub}
        </Text>
      </View>
    </View>
  );
}

function PostTile({ post, hero, solid }: { post: BlogPost; hero?: boolean; solid: 'lime' | 'dark' }) {
  const img = absUrl(post.cover_image_url || post.hero_image_url);
  const isPhoto = !!img;
  const isLime = !isPhoto && solid === 'lime';

  const titleColor = isLime ? colors.black : colors.white;
  const catColor   = isLime ? 'rgba(10,10,10,0.62)' : colors.green;
  const bodyColor  = isLime ? 'rgba(10,10,10,0.74)' : colors.light;
  const metaColor  = isLime ? 'rgba(10,10,10,0.58)' : colors.muted;

  const meta = [
    post.author_name ? `By ${post.author_name}` : null,
    post.reading_time_mins ? `${post.reading_time_mins} min read` : null,
  ].filter(Boolean).join('  ·  ');

  return (
    <Pressable
      onPress={() => router.push(`/blog/${post.slug}`)}
      className="mx-5 mt-3 rounded-atp-lg overflow-hidden active:opacity-80"
      style={{
        backgroundColor: isPhoto ? colors.dark2 : (isLime ? colors.green : colors.dark),
        borderWidth: isPhoto || isLime ? 0 : 1,
        borderColor: 'rgba(255,255,255,0.08)',
        minHeight: hero ? 300 : 180,
        justifyContent: 'flex-end',
      }}
    >
      {isPhoto && (
        <>
          <Image
            source={{ uri: img! }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            resizeMode="cover"
          />
          {/* Scrim — same weighting as the web tiles, so a headline over
              busy photography stays readable. Drawn with react-native-svg
              (already in the build via Avatar) rather than pulling in
              expo-linear-gradient, which isn't installed and couldn't
              ship over an OTA update anyway. */}
          <Svg
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            width="100%"
            height="100%"
          >
            <Defs>
              <SvgGradient id="blogScrim" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0"    stopColor="#0a0a0a" stopOpacity="0.12" />
                <Stop offset="0.42" stopColor="#0a0a0a" stopOpacity="0.45" />
                <Stop offset="1"    stopColor="#0a0a0a" stopOpacity="0.94" />
              </SvgGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#blogScrim)" />
          </Svg>
        </>
      )}

      <Marker dark={isLime} />

      {hero && (
        <View
          style={{ position: 'absolute', top: 0, right: 0, zIndex: 3, backgroundColor: colors.green }}
          className="px-3 py-1.5 rounded-bl-atp"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-[9px] uppercase tracking-widest">
            Latest
          </Text>
        </View>
      )}

      <View className="px-5 pb-5 pt-10" style={{ zIndex: 2 }}>
        {!!post.category && (
          <Text style={{ fontFamily: fontFamily.bodyBold, color: catColor }} className="text-[10px] uppercase tracking-widest mb-1.5">
            {post.category}
          </Text>
        )}
        <Text
          style={{ fontFamily: fontFamily.displayBlack, color: titleColor }}
          className={`uppercase tracking-tight ${hero ? 'text-3xl' : 'text-xl'}`}
        >
          {post.title}
        </Text>
        {!!post.excerpt && hero && (
          <Text style={{ fontFamily: fontFamily.body, color: bodyColor }} className="text-sm mt-2 leading-relaxed" numberOfLines={3}>
            {post.excerpt}
          </Text>
        )}
        {!!meta && (
          <Text style={{ fontFamily: fontFamily.body, color: metaColor }} className="text-[11px] mt-2.5">
            {meta}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
