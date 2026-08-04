/**
 * Book a coach 1:1 with a card HOLD — /coaches/book?coach=<id>[&offering=<id>]
 *
 * Flow: pick an offering → pick a day + time slot (slots generated from
 * the coach's weekly availability windows; sensible 07:00–21:00 fallback
 * when the coach hasn't set any) → optional note → Stripe PaymentSheet.
 *
 * IMPORTANT: the backend creates a MANUAL-CAPTURE PaymentIntent. A
 * successful PaymentSheet means the card hold is placed — the member is
 * only charged when the coach confirms (they have 72 hours). All success
 * copy says "hold placed", never "paid".
 *
 * PaymentSheet wiring replicates lib/components/BookingSheet.tsx (the
 * group-session checkout): same STRIPE_READY guard, same appearance,
 * same silent handling of user cancellation.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStripe } from '@stripe/stripe-react-native';
import Constants from 'expo-constants';
import { getCoach } from '@/lib/api/coaches';
import {
  bookCoachSessionWithCard, getPublicOfferings,
  type CoachAvailabilityWindow, type PublicCoachOffering,
} from '@/lib/api/coachSessions';
import { LoadError } from '@/lib/components/LoadError';
import { colors, fontFamily } from '@/lib/theme/tokens';

const STRIPE_READY = !!(Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.stripePublishableKey;

const SLOT_STEP_MIN = 30;
/** Backend rejects bookings <30 min out; keep a small extra buffer. */
const MIN_LEAD_MS = 45 * 60 * 1000;
const DAYS_AHEAD = 14;

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Generate bookable start times for one day from the coach's weekly
 * windows. Times are treated in the device's local timezone — ATP
 * operates UAE-wide so coach + member clocks agree in practice.
 */
function slotsForDay(day: Date, windows: CoachAvailabilityWindow[], durationMin: number): Date[] {
  const forDay = windows.filter((w) => w.day_of_week === day.getDay());
  // No availability configured at all → open fallback. Availability
  // configured but none on this weekday → coach is off that day.
  const effective: Array<Pick<CoachAvailabilityWindow, 'start_time' | 'end_time'>> =
    windows.length === 0 ? [{ start_time: '07:00', end_time: '21:00' }] : forDay;

  const minStart = Date.now() + MIN_LEAD_MS;
  const seen = new Set<number>();
  const out: Date[] = [];
  for (const w of effective) {
    const [sh, sm] = String(w.start_time).split(':').map(Number);
    const [eh, em] = String(w.end_time).split(':').map(Number);
    const start = new Date(day); start.setHours(sh || 0, sm || 0, 0, 0);
    const end   = new Date(day); end.setHours(eh || 0, em || 0, 0, 0);
    for (let t = start.getTime(); t + durationMin * 60_000 <= end.getTime(); t += SLOT_STEP_MIN * 60_000) {
      if (t >= minStart && !seen.has(t)) { seen.add(t); out.push(new Date(t)); }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export default function BookCoachSession() {
  const params  = useLocalSearchParams<{ coach?: string; offering?: string }>();
  const coachId = String(params.coach || '');
  const qc = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const coachQ = useQuery({
    queryKey: ['coach', coachId],
    queryFn:  () => getCoach(coachId).then((r) => r.coach),
    enabled:  !!coachId,
  });
  const offersQ = useQuery({
    queryKey: ['coach-public-offerings', coachId],
    queryFn:  () => getPublicOfferings(coachId),
    enabled:  !!coachId,
  });

  const offerings    = offersQ.data?.offerings || [];
  const availability = offersQ.data?.availability || [];

  const [offeringId, setOfferingId] = useState<string | null>(String(params.offering || '') || null);
  const [dayIdx, setDayIdx]         = useState(0);
  const [slotIso, setSlotIso]       = useState<string | null>(null);
  const [note, setNote]             = useState('');
  const [busy, setBusy]             = useState(false);
  const [holdPlaced, setHoldPlaced] = useState<{ when: string } | null>(null);

  const offering: PublicCoachOffering | undefined =
    offerings.find((o) => o.id === offeringId) || (offerings.length === 1 ? offerings[0] : undefined);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      d.setHours(0, 0, 0, 0);
      out.push(d);
    }
    return out;
  }, []);

  const slots = useMemo(
    () => {
      const day = days[dayIdx];
      return offering && day ? slotsForDay(day, availability, offering.duration_min) : [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offering?.id, dayIdx, offersQ.dataUpdatedAt]
  );

  const coachName = coachQ.data
    ? (coachQ.data.display_name || `${coachQ.data.first_name} ${coachQ.data.last_name}`)
    : 'The coach';
  const coachFirst = coachQ.data?.first_name || 'The coach';

  async function onPlaceHold() {
    if (!offering || !slotIso || busy) return;
    if (!STRIPE_READY) {
      Alert.alert(
        'Card payments coming soon',
        'Card checkout is being switched on. Please book from the website in the meantime.'
      );
      return;
    }
    setBusy(true);
    try {
      const res = await bookCoachSessionWithCard({
        offering_id:  offering.id,
        scheduled_at: slotIso,
        ...(note.trim() ? { member_note: note.trim() } : {}),
      });
      if (!res.payment?.payment_intent_client_secret) {
        Alert.alert('Card payment unavailable', 'Stripe is not configured for mobile. Please contact ATP support.');
        return;
      }
      const init = await initPaymentSheet({
        merchantDisplayName:        'ATP — At The Park',
        paymentIntentClientSecret:  res.payment.payment_intent_client_secret,
        customerEphemeralKeySecret: res.payment.ephemeral_key,
        customerId:                 res.payment.customer_id,
        defaultBillingDetails:      {},
        appearance: {
          colors: {
            primary:    colors.green,
            background: colors.black,
            componentBackground: colors.dark,
            componentBorder:     'rgba(255,255,255,0.1)',
            componentDivider:    'rgba(255,255,255,0.05)',
            primaryText:   colors.white,
            secondaryText: colors.light,
            placeholderText: colors.muted,
          },
        },
      });
      if (init.error) {
        Alert.alert('Could not start payment', init.error.message);
        return;
      }
      const present = await presentPaymentSheet();
      if (present.error) {
        if (present.error.code !== 'Canceled') {
          Alert.alert('Payment failed', present.error.message);
        }
        // Canceled: stay put — member can pick another slot or retry.
        return;
      }
      // Manual-capture intent: authorization succeeded → HOLD placed.
      setHoldPlaced({ when: slotIso });
      qc.invalidateQueries({ queryKey: ['coach-session-bookings'] });
    } catch (err) {
      Alert.alert('Booking failed', (err as Error).message || 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Hold-placed status view ────────────────────────────────────
  if (holdPlaced && offering) {
    return (
      <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-20 h-20 rounded-full bg-atp-green/15 border border-atp-green/50 items-center justify-center mb-6">
            <Text style={{ fontSize: 34 }}>✓</Text>
          </View>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase text-center">
            Hold placed
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base text-center mt-4 leading-relaxed">
            Your card hold is placed — {coachFirst} has 72 hours to confirm. You're only charged when they confirm.
          </Text>
          <View className="bg-atp-dark border border-white/10 rounded-atp p-4 mt-7 self-stretch">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
              {offering.title} with {coachName}
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
              {new Date(holdPlaced.when).toLocaleString()} · {offering.duration_min} min
            </Text>
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green, fontVariant: ['tabular-nums'] }} className="text-sm mt-2">
              AED {Number(offering.price_aed).toLocaleString()} on hold
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            className="rounded-atp py-4 items-center bg-atp-green active:opacity-80 self-stretch mt-8"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              Done
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Booking form ───────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Book 1:1{coachQ.data ? ` · ${coachFirst}` : ''}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        {offersQ.isLoading ? (
          <View className="px-5 pt-8"><ActivityIndicator color={colors.green} /></View>
        ) : offersQ.isError ? (
          <View className="px-5 pt-6"><LoadError onRetry={() => offersQ.refetch()} /></View>
        ) : offerings.length === 0 ? (
          <View className="px-5 pt-8">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
              This coach has no bookable 1:1 offerings right now.
            </Text>
          </View>
        ) : (
          <>
            {/* 1 — offering */}
            <View className="px-5 mt-5">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
                1 · Pick a session
              </Text>
              <View className="gap-2">
                {offerings.map((o) => {
                  const active = offering?.id === o.id;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => { setOfferingId(o.id); setSlotIso(null); }}
                      className={`rounded-atp p-4 border ${active ? 'bg-atp-green/15 border-atp-green/50' : 'bg-atp-dark border-white/5'} active:opacity-80`}
                    >
                      <View className="flex-row items-center justify-between">
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1 pr-3">
                          {o.title}
                        </Text>
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: active ? colors.green : colors.white, fontVariant: ['tabular-nums'] }} className="text-sm">
                          AED {Number(o.price_aed).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
                        {o.duration_min} min{o.description ? ` · ${o.description}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* 2 — day + time */}
            {!!offering && (
              <View className="mt-6">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2 px-5">
                  2 · Pick a time
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                  {days.map((d, i) => {
                    const active = i === dayIdx;
                    return (
                      <Pressable
                        key={dayKey(d)}
                        onPress={() => { setDayIdx(i); setSlotIso(null); }}
                        className={`rounded-atp px-3 py-2 border items-center ${active ? 'bg-atp-green border-atp-green' : 'bg-atp-dark border-white/10'} active:opacity-80`}
                      >
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: active ? colors.black : colors.white }} className="text-xs uppercase">
                          {d.toLocaleDateString(undefined, { weekday: 'short' })}
                        </Text>
                        <Text style={{ fontFamily: fontFamily.body, color: active ? colors.black : colors.muted }} className="text-xs mt-0.5">
                          {d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View className="px-5 mt-3 flex-row flex-wrap gap-2">
                  {slots.length === 0 ? (
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                      No available times this day — try another.
                    </Text>
                  ) : (
                    slots.map((s) => {
                      const iso = s.toISOString();
                      const active = slotIso === iso;
                      return (
                        <Pressable
                          key={iso}
                          onPress={() => setSlotIso(iso)}
                          className={`rounded-atp px-3.5 py-2 border ${active ? 'bg-atp-green border-atp-green' : 'bg-atp-dark border-white/10'} active:opacity-80`}
                        >
                          <Text style={{ fontFamily: fontFamily.bodyBold, color: active ? colors.black : colors.white, fontVariant: ['tabular-nums'] }} className="text-xs">
                            {s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              </View>
            )}

            {/* 3 — note */}
            {!!offering && (
              <View className="px-5 mt-6">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
                  3 · Anything the coach should know? (optional)
                </Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="Goals, injuries, experience level…"
                  placeholderTextColor={colors.muted}
                  multiline
                  maxLength={500}
                  style={{ fontFamily: fontFamily.body, color: colors.white, minHeight: 72, textAlignVertical: 'top' }}
                  className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 text-sm"
                />
              </View>
            )}

            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs px-5 mt-5 leading-relaxed">
              Your card is NOT charged now. We place a hold, {coachFirst} has 72 hours to confirm, and you're only charged when they confirm. If they decline or don't respond, the hold is released.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Sticky CTA */}
      {!!offering && offerings.length > 0 && (
        <View className="absolute bottom-0 left-0 right-0 px-5 pb-7 pt-3 bg-atp-black border-t border-white/5">
          <Pressable
            onPress={onPlaceHold}
            disabled={!slotIso || busy}
            className={`rounded-atp py-4 items-center ${slotIso && !busy ? 'bg-atp-green active:opacity-80' : 'bg-atp-dark-3'}`}
          >
            {busy ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: slotIso ? colors.black : colors.muted, fontVariant: ['tabular-nums'] }}
                className="text-base uppercase tracking-widest"
              >
                {slotIso ? `Place hold · AED ${Number(offering.price_aed).toLocaleString()}` : 'Pick a time'}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
