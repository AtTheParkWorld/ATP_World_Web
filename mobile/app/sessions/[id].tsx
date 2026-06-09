/**
 * Session detail + booking flow.
 *
 * States:
 *   - loading: spinner
 *   - free session, not booked       → "Reserve free spot" button
 *   - paid session, not booked       → "Continue" → opens BookingSheet (AED vs Points)
 *   - already booked (any tier)      → "You're in" badge + cancel button
 *   - waitlisted                     → "Waitlist position #N" badge + cancel button
 *
 * After a successful booking we invalidate ['my-bookings'], ['sessions']
 * and the per-session query so the Home + Sessions tabs refresh in
 * background, and the user lands back on this detail screen with the
 * fresh state ("You're in").
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSession } from '@/lib/api/sessions';
import { createBooking, cancelBooking, listMyBookings, type PaymentOptions, type BookingRecord } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { BookingSheet } from '@/lib/components/BookingSheet';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { dayHeader, timeShort } from '@/lib/utils/date';

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);
  const qc = useQueryClient();

  const sessionQ = useQuery({
    queryKey: ['session', sessionId],
    queryFn:  () => getSession(sessionId).then(r => r.session),
    enabled:  Number.isFinite(sessionId),
  });

  const myBookingsQ = useQuery({
    queryKey: ['my-bookings'],
    queryFn:  () => listMyBookings().then(r => r.bookings),
  });

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | { booking: BookingRecord; opts: PaymentOptions }>(null);

  const s = sessionQ.data;
  const myBooking = (myBookingsQ.data || []).find(
    (b) => b.session_id === sessionId && b.status !== 'cancelled'
  );

  async function onBookPress() {
    if (!s) return;
    setBusy(true);
    try {
      const res = await createBooking(s.id);
      if (res.payment_options) {
        // Paid session — pop the sheet to pick AED vs points.
        setSheet({ booking: res.booking, opts: res.payment_options });
      } else {
        // Free session or waitlist confirmed — refresh + show outcome.
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['my-bookings'] }),
          qc.invalidateQueries({ queryKey: ['session', s.id] }),
          qc.invalidateQueries({ queryKey: ['sessions'] }),
          qc.invalidateQueries({ queryKey: ['streak'] }),
        ]);
        const msg = res.status === 'waitlisted'
          ? `You're on the waitlist at position #${res.waitlist_position}. We'll text you if a spot opens.`
          : `You're in. ${res.points_awarded ? `+${res.points_awarded} pts.` : ''} See you there.`;
        Alert.alert(res.status === 'waitlisted' ? 'Waitlisted' : 'Booked', msg);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        Alert.alert('Already booked', 'You already have a booking for this session.');
      } else {
        Alert.alert('Could not book', (err as Error).message || 'Try again in a moment.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onCancelPress() {
    if (!myBooking) return;
    Alert.alert(
      'Cancel booking?',
      'Cancelling within 2 hours of start may lose your reward points.',
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel anyway', style: 'destructive', onPress: async () => {
            setBusy(true);
            try {
              await cancelBooking(myBooking.id);
              await Promise.all([
                qc.invalidateQueries({ queryKey: ['my-bookings'] }),
                qc.invalidateQueries({ queryKey: ['session', sessionId] }),
              ]);
            } catch (err) {
              Alert.alert('Cancel failed', (err as Error).message || 'Try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  if (sessionQ.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-atp-black items-center justify-center" edges={['top']}>
        <ActivityIndicator color={colors.green} size="large" />
      </SafeAreaView>
    );
  }

  if (!s) {
    return (
      <SafeAreaView className="flex-1 bg-atp-black items-center justify-center px-8" edges={['top']}>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>Session not found.</Text>
        <Pressable onPress={() => router.back()} className="mt-6 px-5 py-3 bg-atp-dark-3 rounded-atp">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const tColor = tribeColor(s.tribe_slug);
  const isFull = s.capacity != null && s.registrations_count >= s.capacity;
  const priceLbl = s.session_type === 'paid' && s.price
    ? `${s.currency_code || 'AED'} ${s.price}`
    : 'Free';

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View className="px-5 pt-2 flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
          </Pressable>
        </View>

        <View className="px-5 mt-2">
          {!!s.tribe_name && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: tColor }} className="text-xs uppercase tracking-widest mb-2">
              {s.tribe_name}
            </Text>
          )}
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl uppercase tracking-tight">
            {s.name}
          </Text>
        </View>

        {/* Status pill row */}
        <View className="px-5 mt-4 flex-row flex-wrap gap-2">
          <InfoPill label={dayHeader(s.scheduled_at)} />
          <InfoPill label={timeShort(s.scheduled_at)} />
          {!!s.city_name     && <InfoPill label={`📍 ${s.city_name}`} />}
          {!!s.activity_name && <InfoPill label={`${s.activity_icon || '•'} ${s.activity_name}`} />}
          <InfoPill label={priceLbl} accent={s.session_type === 'paid' ? colors.warning : colors.green} />
          {s.points_reward ? <InfoPill label={`+${s.points_reward} pts`} accent={colors.green} /> : null}
        </View>

        {/* Capacity bar */}
        {s.capacity != null && (
          <View className="px-5 mt-5">
            <View className="bg-atp-dark rounded-full h-2 overflow-hidden">
              <View
                style={{
                  width: `${Math.min(100, (s.registrations_count / s.capacity) * 100)}%`,
                  backgroundColor: isFull ? colors.danger : colors.green,
                  height: '100%',
                }}
              />
            </View>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-2">
              {isFull
                ? `Full · ${s.waitlist_count} on waitlist`
                : `${s.registrations_count}/${s.capacity} confirmed`}
            </Text>
          </View>
        )}

        {/* Description */}
        {!!s.description && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              About this session
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base leading-relaxed">
              {s.description}
            </Text>
          </View>
        )}

        {/* Location */}
        {!!s.location && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Location
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-base">
              {s.location}
            </Text>
            {!!s.location_maps_url && (
              <Pressable
                onPress={() => Linking.openURL(s.location_maps_url!)}
                className="mt-2 self-start"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">
                  Open in Maps →
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Coach */}
        {!!s.coach_name && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Coach
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-base">
              {s.coach_name}
            </Text>
          </View>
        )}

        {/* Sponsor */}
        {!!s.sponsor_name && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
              Powered by
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-base">
              {s.sponsor_name}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 px-5 pb-7 pt-3 bg-atp-black border-t border-white/5">
        {myBooking ? (
          <View>
            <View className="bg-atp-green/15 border border-atp-green/40 rounded-atp px-4 py-3 mb-2">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm uppercase tracking-widest">
                {myBooking.status === 'waitlisted' ? 'On waitlist' : "You're in"}
              </Text>
              {myBooking.status === 'attended' ? null : (
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-0.5">
                  Tap your QR in Profile when you arrive.
                </Text>
              )}
            </View>
            <Pressable
              onPress={onCancelPress}
              disabled={busy}
              className="rounded-atp py-4 items-center bg-atp-dark-3 active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
                {busy ? 'Working…' : 'Cancel booking'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onBookPress}
            disabled={busy || s.status !== 'upcoming'}
            className={`rounded-atp py-4 items-center ${busy || s.status !== 'upcoming' ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base">
              {busy ? 'Booking…'
                : s.status !== 'upcoming' ? 'Session closed'
                : isFull ? 'Join waitlist'
                : s.session_type === 'paid' ? 'Continue' : 'Reserve free spot'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Paid-session payment sheet */}
      {sheet && (
        <BookingSheet
          booking={sheet.booking}
          opts={sheet.opts}
          onClose={() => setSheet(null)}
          onSuccess={async () => {
            setSheet(null);
            await Promise.all([
              qc.invalidateQueries({ queryKey: ['my-bookings'] }),
              qc.invalidateQueries({ queryKey: ['session', sessionId] }),
              qc.invalidateQueries({ queryKey: ['sessions'] }),
              qc.invalidateQueries({ queryKey: ['stats'] }),
            ]);
            Alert.alert('Booked', "You're in. See you there.");
          }}
        />
      )}
    </SafeAreaView>
  );
}

function InfoPill({ label, accent }: { label: string; accent?: string }) {
  const color = accent || colors.light;
  return (
    <View
      className="rounded-full px-3 py-1.5"
      style={{ borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.03)' }}
    >
      <Text style={{ fontFamily: fontFamily.bodyBold, color }} className="text-xs">
        {label}
      </Text>
    </View>
  );
}
