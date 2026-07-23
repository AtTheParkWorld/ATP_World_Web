/**
 * Post-session rating. Rendered on the session detail screen (and the
 * My Bookings past rows) once a booking is status='attended' — the
 * backend rejects feedback on anything else with a 404.
 *
 * POST /bookings/:id/feedback { rating, comment } is idempotent
 * (ON CONFLICT DO NOTHING) and awards feedback points on first submit,
 * so a second tap is harmless; we still flip to the thank-you state so
 * the member isn't invited to rate twice.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitSessionFeedback } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';

export function FeedbackBlock({ bookingId }: { bookingId: number }) {
  const qc = useQueryClient();
  const [rating, setRating]   = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => submitSessionFeedback(bookingId, rating, comment.trim() || undefined),
    onSuccess: () => {
      setDone(true);
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      qc.invalidateQueries({ queryKey: ['points'] });
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
            ✓ Thanks for the feedback!
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
        Rate this session
      </Text>
      <View className="bg-atp-dark border border-white/5 rounded-atp p-4">
        <View className="flex-row justify-center gap-2 mb-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => { setRating(n); setError(null); }} hitSlop={6} className="active:opacity-60">
              <Text style={{ fontSize: 30, color: n <= rating ? colors.green : colors.dark3 }}>★</Text>
            </Pressable>
          ))}
        </View>
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
