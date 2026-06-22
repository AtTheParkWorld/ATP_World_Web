/**
 * Coach detail. Hero photo, headline, bio, specialties, rating.
 * Reads from the nested coach response (profile/social/stats sub-objects).
 *
 * "Book a 1:1 session" deep-links to the web for now; native coach-
 * session booking lands in Phase 7.
 */
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getCoach } from '@/lib/api/coaches';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function CoachDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const coachId = String(id || '');

  const q = useQuery({
    queryKey: ['coach', coachId],
    queryFn:  () => getCoach(coachId).then(r => r.coach),
    enabled:  !!coachId,
  });

  const c = q.data;
  const profile = c?.profile;
  const social  = c?.social;
  const stats   = c?.stats;

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
            {profile?.profile_photo_url
              ? <Image source={{ uri: absUrl(profile.profile_photo_url)! }} className="w-32 h-32" />
              : <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.muted }} className="text-4xl">
                  {(c?.first_name || '?')[0]}{(c?.last_name || '')[0]}
                </Text>}
          </View>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase text-center">
            {c ? (c.display_name || `${c.first_name} ${c.last_name}`) : ' '}
          </Text>
          {!!profile?.tagline && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm text-center mt-2 px-4">
              {profile.tagline}
            </Text>
          )}
          {stats && stats.rating_avg > 0 && stats.rating_count > 0 && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-sm mt-3">
              ★ {stats.rating_avg.toFixed(1)} · {stats.rating_count} reviews
            </Text>
          )}
          {!!c?.city && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
              📍 {c.city}
            </Text>
          )}
          {stats && Number(stats.total_sessions) > 0 && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
              {stats.total_sessions} sessions led · {stats.upcoming_sessions} upcoming
            </Text>
          )}
        </View>

        {!!profile?.specialties && profile.specialties.length > 0 && (
          <View className="px-5 mt-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Specialties
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {profile.specialties.map((s) => (
                <View key={s} className="bg-atp-dark border border-white/10 rounded-full px-3 py-1.5">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!!profile?.certifications && profile.certifications.length > 0 && (
          <View className="px-5 mt-4">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Certifications
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {profile.certifications.map((s) => (
                <View key={s} className="bg-atp-dark border border-white/10 rounded-full px-3 py-1.5">
                  <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!!profile?.bio && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              About
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base leading-relaxed">
              {profile.bio}
            </Text>
          </View>
        )}

        {!!profile?.philosophy && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Coaching philosophy
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base leading-relaxed">
              {profile.philosophy}
            </Text>
          </View>
        )}

        {!!social?.instagram && (
          <View className="px-5 mt-6">
            <Pressable
              onPress={() => Linking.openURL(`https://instagram.com/${social.instagram!.replace(/^@/, '')}`)}
              className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 self-start"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                @{social.instagram.replace(/^@/, '')} on Instagram
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Sticky CTA — web-side booking until native ships in Phase 7 */}
      {!!c?.slug && profile?.accepts_private_sessions && (
        <View className="absolute bottom-0 left-0 right-0 px-5 pb-7 pt-3 bg-atp-black border-t border-white/5">
          <Pressable
            onPress={() => Linking.openURL(`https://atthepark.world/coach/${c.slug}?book=1`)}
            className="rounded-atp py-4 items-center bg-atp-green active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              Book a 1:1 session
            </Text>
          </Pressable>
          {!!profile.private_session_info && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs text-center mt-2">
              {profile.private_session_info}
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
