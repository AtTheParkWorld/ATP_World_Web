import { WEB_BASE } from '@/lib/api/client';
/**
 * Coach detail. Hero photo, headline, bio, specialties, rating.
 * Reads from the nested coach response (profile/social/stats sub-objects).
 *
 * 1:1 booking: coaches with active priced offerings get the native
 * "Book & pay by card" flow (/coaches/book — Stripe card HOLD, coach
 * confirms within 72h). Coaches without offerings fall back to the
 * web booking link.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getCoach, rateCoach, type CoachFeedback } from '@/lib/api/coaches';
import { useAuthStore } from '@/lib/stores/auth.store';
import { getPublicOfferings } from '@/lib/api/coachSessions';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function CoachDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const coachId = String(id || '');
  const me = useAuthStore((s) => s.member) as any;
  const isMe = !!me?.id && String(me.id) === coachId;

  // Full detail response — coach + feedback list ride the same query so a
  // single refetch after rating refreshes both the average and the list.
  const q = useQuery({
    queryKey: ['coach', coachId],
    queryFn:  () => getCoach(coachId),
    enabled:  !!coachId,
  });
  const offersQ = useQuery({
    queryKey: ['coach-public-offerings', coachId],
    queryFn:  () => getPublicOfferings(coachId),
    enabled:  !!coachId,
  });
  const offerings = (offersQ.data?.offerings || []).filter((o) => Number(o.price_aed) > 0);

  const c = q.data?.coach;
  const feedback = q.data?.feedback || [];
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
              onPress={() => Linking.openURL(`${WEB_BASE}/coach/${c.slug}`)}
              className="py-2 px-2"
            >
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">Share</Text>
            </Pressable>
          )}
        </View>

        <View className="items-center pt-3 pb-6 px-5">
          <View className="w-32 h-32 rounded-full bg-atp-dark-3 overflow-hidden items-center justify-center mb-4">
            {(profile?.display_photo_url || profile?.profile_photo_url)
              ? <Image source={{ uri: absUrl(profile.display_photo_url || profile.profile_photo_url)! }} className="w-32 h-32" />
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

        {/* 1:1 offerings — native card-hold booking */}
        {offerings.length > 0 && (
          <View className="px-5 mt-2 mb-4">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              1-on-1 sessions
            </Text>
            <View className="gap-2">
              {offerings.map((o) => (
                <View key={o.id} className="bg-atp-dark border border-white/5 rounded-atp p-4">
                  <View className="flex-row items-center justify-between">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1 pr-3">
                      {o.title}
                    </Text>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green, fontVariant: ['tabular-nums'] }} className="text-sm">
                      AED {Number(o.price_aed).toLocaleString()}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1" numberOfLines={2}>
                    {o.duration_min} min{o.description ? ` · ${o.description}` : ''}
                  </Text>
                  <Pressable
                    onPress={() => router.push(`/coaches/book?coach=${coachId}&offering=${o.id}`)}
                    className="mt-3 rounded-atp py-2.5 items-center bg-atp-green/15 border border-atp-green/50 active:opacity-80"
                  >
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                      Book &amp; pay by card
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-2">
              Card is only charged once the coach confirms your request.
            </Text>
          </View>
        )}

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

        {/* Rate this coach — POST upserts, so re-rating just updates yours */}
        {!!c && (
          <View className="px-5 mt-8">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Rate this coach
            </Text>
            {/* A coach can't rate themselves (founder 2026-09-17) — the
                backend refuses it too; this just avoids offering it. */}
            {!isMe && (
              <RateCoachCard coachId={coachId} onSubmitted={() => q.refetch()} />
            )}
          </View>
        )}

        {/* Feedback list */}
        {feedback.length > 0 && (
          <View className="px-5 mt-8">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              What members say ({feedback.length})
            </Text>
            <View className="gap-2">
              {feedback.map((f) => <FeedbackRow key={f.id} f={f} />)}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Sticky CTA — native card-hold booking when the coach has
          priced offerings; web fallback otherwise. */}
      {((offerings.length > 0) || (!!c?.slug && profile?.accepts_private_sessions)) && (
        <View className="absolute bottom-0 left-0 right-0 px-5 pb-7 pt-3 bg-atp-black border-t border-white/5">
          <Pressable
            onPress={() =>
              offerings.length > 0
                ? router.push(`/coaches/book?coach=${coachId}`)
                : Linking.openURL(`${WEB_BASE}/coach/${c!.slug}?book=1`)
            }
            className="rounded-atp py-4 items-center bg-atp-green active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              Book a 1:1 session
            </Text>
          </Pressable>
          {!!profile?.private_session_info && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs text-center mt-2">
              {profile.private_session_info}
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

/** Static 1–5 star strip. Filled = lime, empty = muted outline. */
function Stars({ rating, size = 13 }: { rating: number; size?: number }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <Text style={{ fontSize: size, letterSpacing: 1 }}>
      <Text style={{ color: colors.green }}>{'★'.repeat(r)}</Text>
      <Text style={{ color: colors.muted }}>{'☆'.repeat(5 - r)}</Text>
    </Text>
  );
}

/** Tap-to-rate card: 5 stars + optional comment. Success shows an inline
 *  confirmation and the parent refetches so the list + average update. */
function RateCoachCard({ coachId, onSubmitted }: { coachId: string; onSubmitted: () => void }) {
  const [rating, setRating]       = useState(0);
  const [comment, setComment]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]           = useState(false);

  async function submit() {
    if (!rating || submitting) return;
    setSubmitting(true);
    try {
      await rateCoach(coachId, { rating, comment: comment.trim() || undefined });
      setDone(true);
      onSubmitted();
    } catch (err) {
      Alert.alert('Could not submit rating', (err as Error).message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View className="bg-atp-dark border border-white/5 rounded-atp-lg p-4">
      <View className="flex-row justify-center gap-2 py-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => { setRating(n); setDone(false); }}
            hitSlop={6}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
          >
            <Text style={{ fontSize: 28, color: n <= rating ? colors.green : colors.muted }}>
              {n <= rating ? '★' : '☆'}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={(t) => { setComment(t); setDone(false); }}
        placeholder="Add a comment (optional)"
        placeholderTextColor={colors.muted}
        multiline
        maxLength={1000}
        style={{ fontFamily: fontFamily.body, color: colors.white, minHeight: 64, textAlignVertical: 'top' }}
        className="bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-3 text-sm mt-3"
      />
      {done ? (
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs text-center mt-4">
          Thanks — your rating is in.
        </Text>
      ) : (
        <Pressable
          onPress={submit}
          disabled={!rating || submitting}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
          className={`mt-4 rounded-atp py-3 items-center ${rating ? 'bg-atp-green' : 'bg-atp-dark-3'}`}
        >
          {submitting
            ? <ActivityIndicator color={colors.black} size="small" />
            : <Text style={{ fontFamily: fontFamily.bodyBold, color: rating ? colors.black : colors.muted }} className="text-xs uppercase tracking-widest">
                Submit rating
              </Text>}
        </Pressable>
      )}
    </View>
  );
}

function FeedbackRow({ f }: { f: CoachFeedback }) {
  const name = `${f.first_name || 'Member'} ${f.last_name || ''}`.trim();
  return (
    <View className="bg-atp-dark border border-white/5 rounded-atp p-4">
      <View className="flex-row items-center justify-between">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1 pr-3" numberOfLines={1}>
          {name}
        </Text>
        <Stars rating={f.rating} />
      </View>
      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-0.5">
        {new Date(f.created_at).toLocaleDateString()}
      </Text>
      {!!f.comment && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2 leading-relaxed">
          {f.comment}
        </Text>
      )}
    </View>
  );
}
