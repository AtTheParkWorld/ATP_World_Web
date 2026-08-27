/**
 * Post-session rating. Rendered on the session detail screen once a
 * booking is status='attended' — the backend rejects feedback on
 * anything else with a 404.
 *
 * Two scores: "The session" (required) and "Your coach" (optional —
 * the row only renders when the parent passes a coachName, e.g. the
 * session detail's s.coach_name; screens without coach data simply
 * omit the prop). coach_rating flows to the coach's public average.
 *
 * POST /bookings/:id/feedback { rating, comment, coach_rating? } is
 * idempotent (ON CONFLICT DO NOTHING) and awards feedback points on
 * first submit, so a second tap is harmless; we still flip to the
 * thank-you state so the member isn't invited to rate twice.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitSessionFeedback } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';

/** Label + 5 tap stars. Same star treatment as the original single row. */
function StarRow({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <View className="mb-3">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.light }} className="text-xs uppercase tracking-widest mb-1">
        {label}
      </Text>
      <View className="flex-row justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => onChange(n)} hitSlop={6} className="active:opacity-60">
            <Text style={{ fontSize: 30, color: n <= value ? colors.green : colors.dark3 }}>★</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

interface Props {
  bookingId: string | number;
  /** Coach display name — when provided, a second "Your coach" star row appears. */
  coachName?: string | null;
}

export function FeedbackBlock({ bookingId, coachName }: Props) {
  const qc = useQueryClient();
  const [rating, setRating]           = useState(0);
  const [coachRating, setCoachRating] = useState(0);
  const [comment, setComment]         = useState('');
  const [done, setDone]               = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      submitSessionFeedback(
        bookingId,
        rating,
        comment.trim() || undefined,
        coachRating > 0 ? { coach_rating: coachRating } : undefined
      ),
    onSuccess: () => {
      setDone(true);
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      qc.invalidateQueries({ queryKey: ['points'] });
      // Refresh the series score + "What members say" list on detail screens.
      qc.invalidateQueries({ queryKey: ['session-feedback'] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e) => {
      // 404 = already rated / not attended — treat as done, not an error.
      if (e instanceof ApiError && e.status === 404) { setDone(true); return; }
      setError((e as Error).message || 'Could not submit — try again.');
    },
  });

  if (done) {
    return (
      <View className="px-5 mt-6">
        <View className="bg-atp-dark border border-atp-green/30 rounded-atp p-4">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">
            Thanks! Your scores are in 💪
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
            Your rating helps the coaches make every session better.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="px-5 mt-6">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
        How was it? ⭐
      </Text>
      <View className="bg-atp-dark border border-white/5 rounded-atp p-4">
        <StarRow label="The session" value={rating} onChange={(n) => { setRating(n); setError(null); }} />
        {!!coachName && (
          <StarRow label={`Your coach — ${coachName}`} value={coachRating} onChange={(n) => { setCoachRating(n); setError(null); }} />
        )}
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Add a comment (optional)"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={500}
          style={{ fontFamily: fontFamily.body, color: colors.white, minHeight: 60, textAlignVertical: 'top' }}
          className="bg-atp-black border border-white/10 rounded-atp px-3 py-2 text-sm"
        />
        {error && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-xs mt-2">{error}</Text>
        )}
        <Pressable
          disabled={rating === 0 || mutation.isPending}
          onPress={() => mutation.mutate()}
          className={`mt-3 rounded-atp py-3 items-center ${rating === 0 || mutation.isPending ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
        >
          <Text
            style={{ fontFamily: fontFamily.bodyBold, color: rating === 0 || mutation.isPending ? colors.muted : colors.black }}
            className="text-sm uppercase tracking-widest"
          >
            {mutation.isPending ? 'Sending…' : 'Submit rating'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
