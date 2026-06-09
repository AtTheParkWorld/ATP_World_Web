/**
 * Coach detail. Hero photo, headline, bio, specialties, rating, and
 * (when coach_sessions are enabled) a "Book a 1:1 session" CTA. Phase
 * 7 will wire the actual coach-session booking flow; this screen
 * deep-links to the web-side detail page as a fallback in the
 * meantime so we don't block coverage.
 */
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getCoach } from '@/lib/api/coaches';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function CoachDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const coachId = String(id);

  const q = useQuery({
    queryKey: ['coach', coachId],
    queryFn:  () => getCoach(coachId).then(r => r.coach),
  });

  const c = q.data;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View className="px-5 pt-2 pb-3 flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
          </Pressable>
          {!!c?.slug && (
            <Pressable
              onPress={() => Linking.openURL(`https://atthepark.world/coach/${c.slug}`)}
              className="py-2 px-2"
            >
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">Share</Text>
            </Pressable>
          )}
        </View>

        <View className="items-center pt-3 pb-6 px-5">
          <View className="w-32 h-32 rounded-full bg-atp-dark-3 overflow-hidden items-center justify-center mb-4">
            {c?.avatar_url
              ? <Image source={{ uri: c.avatar_url }} className="w-32 h-32" />
              : <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.muted }} className="text-4xl">
                  {(c?.first_name || '?')[0]}{(c?.last_name || '')[0]}
                </Text>}
          </View>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase text-center">
            {c ? `${c.first_name} ${c.last_name}` : ' '}
          </Text>
          {!!c?.headline && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm text-center mt-2 px-4">
              {c.headline}
            </Text>
          )}
          {c?.rating_avg != null && c.rating_count > 0 && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-sm mt-3">
              ★ {c.rating_avg.toFixed(1)} · {c.rating_count} reviews
            </Text>
          )}
          {!!c?.city_name && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
              📍 {c.city_name}
            </Text>
          )}
        </View>

        {!!c?.specialties && c.specialties.length > 0 && (
          <View className="px-5 mt-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Specialties
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {c.specialties.map((s) => (
                <View key={s} className="bg-atp-dark border border-white/10 rounded-full px-3 py-1.5">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!!c?.bio && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              About
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base leading-relaxed">
              {c.bio}
            </Text>
          </View>
        )}

        {!!c?.social_instagram && (
          <View className="px-5 mt-6">
            <Pressable
              onPress={() => Linking.openURL(`https://instagram.com/${(c.social_instagram || '').replace(/^@/, '')}`)}
              className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 self-start"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                @{c.social_instagram.replace(/^@/, '')} on Instagram
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Sticky CTA — web-side booking page until Phase 7 ships native */}
      {!!c?.slug && (
        <View className="absolute bottom-0 left-0 right-0 px-5 pb-7 pt-3 bg-atp-black border-t border-white/5">
          <Pressable
            onPress={() => Linking.openURL(`https://atthepark.world/coach/${c.slug}?book=1`)}
            className={`rounded-atp py-4 items-center ${c.is_accepting_sessions === false ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
            disabled={c.is_accepting_sessions === false}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              {c.is_accepting_sessions === false ? 'Not accepting sessions' : 'Book a 1:1 session'}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
