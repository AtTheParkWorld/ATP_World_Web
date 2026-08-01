/**
 * MyNextSession — the member's soonest upcoming booking as a tappable
 * card. Shared by Home and Profile (founder 2026-08-01: "My Next
 * Session" means THEIR booking, not general discovery).
 *
 * Owns its own ['my-bookings'] query so both screens stay in sync via
 * the React Query cache — pull-to-refresh on either screen just
 * invalidates the key. Tapping the card deep-links to /sessions/[id];
 * with nothing booked it shows a friendly pointer to the BOOK A
 * SESSION CTA and taps through to the Sessions tab.
 */
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listMyBookings, type BookingRecord } from '@/lib/api/bookings';
import { colors, fontFamily } from '@/lib/theme/tokens';

export function MyNextSession() {
  const bookingsQ = useQuery({ queryKey: ['my-bookings'], queryFn: () => listMyBookings().then(r => r.bookings) });

  // Soonest non-cancelled future booking — sort, don't trust API order.
  const next = (bookingsQ.data || [])
    .filter((b: BookingRecord) => b.status !== 'cancelled' && b.scheduled_at && new Date(b.scheduled_at).getTime() > Date.now())
    .sort((a: BookingRecord, b: BookingRecord) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] || null;

  return (
    <View>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
        My Next Session
      </Text>
      {bookingsQ.isLoading ? (
        <ActivityIndicator color={colors.green} />
      ) : next ? (
        <Pressable
          onPress={() => router.push(`/sessions/${next.session_id}`)}
          className="bg-atp-dark rounded-atp-lg border border-white/5 p-5 active:opacity-70"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-1">
            {next.tribe_name || next.city_name || 'Booked'}
          </Text>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
            {next.session_name}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2">
            {next.scheduled_at && new Date(next.scheduled_at).toLocaleString()}
          </Text>
          {!!next.location && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
              📍 {next.location}
            </Text>
          )}
          {!!next.qr_token && (
            <View className="mt-3 self-start bg-atp-green/15 border border-atp-green/40 px-3 py-1.5 rounded-full">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                Tap to show QR
              </Text>
            </View>
          )}
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.push('/(tabs)/sessions')}
          className="bg-atp-dark rounded-atp-lg border border-dashed border-white/10 p-5 active:opacity-70"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm uppercase tracking-widest">
            Nothing booked yet
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
            Hit BOOK A SESSION to grab your spot →
          </Text>
        </Pressable>
      )}
    </View>
  );
}
