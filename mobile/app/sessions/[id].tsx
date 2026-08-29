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
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { getSession, getSessionFeedback, getSessionAttendees, type Session } from '@/lib/api/sessions';
import { useConfig } from '@/lib/api/config';
import { getStreak } from '@/lib/api/members';
import { useAuthStore } from '@/lib/stores/auth.store';
import { createBooking, cancelBooking, listMyBookings, submitSessionFeedback, type PaymentOptions, type BookingRecord } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { BookingSheet } from '@/lib/components/BookingSheet';
import { SessionTerms } from '@/lib/components/SessionTerms';
import { FeedbackBlock } from '@/lib/components/FeedbackBlock';
import { CorporateSessionBadge } from '@/lib/components/SessionCard';
import { Avatar } from '@/lib/components/Avatar';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { dayHeader, timeShort } from '@/lib/utils/date';

export default function SessionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = String(id || '');
  const qc = useQueryClient();
  // Points-rule labelling (founder 2026-09-02): free members earn
  // attendance points only while on a 5+ day streak — the reward pill
  // must not promise points they won't receive. Premium always earns;
  // a free member on a qualifying streak earns the base amount.
  const member = useAuthStore((s) => s.member) as any;
  // Booking terms must be accepted before the CTA arms (founder
  // 2026-09-14) — the live text is an accident waiver + liability
  // release + media consent, matching the website's gate.
  const [termsOk, setTermsOk] = useState(false);
  const cfg = useConfig();
  // "Who's going" — tapping the capacity bar opens the attendee list
  // (founder 2026-09-15).
  const [showWho, setShowWho] = useState(false);
  const attendeesQ = useQuery({
    queryKey: ['session-attendees', sessionId],
    queryFn: () => getSessionAttendees(sessionId).then((r) => r.attendees),
    enabled: showWho,
  });
  const streakQ = useQuery({ queryKey: ['streak'], queryFn: () => getStreak().then((r) => r.streak) });
  const isPremium = ['premium', 'premium_plus'].includes(member?.subscription_type);
  const earnsAtCheckin = isPremium || (streakQ.data?.current_streak ?? 0) >= cfg.streak_double_threshold;

  const sessionQ = useQuery({
    queryKey: ['session', sessionId],
    queryFn:  () => getSession(sessionId).then(r => r.session),
    enabled:  !!sessionId,
  });

  const myBookingsQ = useQuery({
    queryKey: ['my-bookings'],
    queryFn:  () => listMyBookings().then(r => r.bookings),
  });

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | { booking: BookingRecord; opts: PaymentOptions }>(null);

  const s = sessionQ.data;
  const myBooking = (myBookingsQ.data || []).find(
    (b) => String(b.session_id) === sessionId && b.status !== 'cancelled'
  );

  // GET /api/sessions/:id now joins corporate_accounts and returns
  // corporate_company_name directly (verified live, API audit
  // 2026-08-30) — use it first. The Sessions-tab cache remains as a
  // fallback for pre-migration backends that answer NULL, and the
  // generic "Private session" copy covers everything else.
  const corporateName = useMemo(() => {
    if (s?.corporate_company_name) return s.corporate_company_name;
    for (const [, data] of qc.getQueriesData<Session[]>({ queryKey: ['sessions'] })) {
      if (!Array.isArray(data)) continue;
      const hit = data.find((x) => x && String(x.id) === sessionId);
      if (hit?.corporate_company_name) return hit.corporate_company_name;
    }
    return null;
  }, [qc, sessionId, s]);

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
        // API audit 2026-08-30: the free-booking response never
        // carries points_awarded (points land at check-in), so no
        // "+X pts" here — the reward pill above already explains it.
        const msg = res.status === 'waitlisted'
          ? `You're on the waitlist at position #${res.waitlist_position}. We'll text you if a spot opens.`
          : `You're in. See you there.`;
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
          {!!s.is_corporate_only && (
            <View className="flex-row mb-2">
              <CorporateSessionBadge companyName={corporateName} />
            </View>
          )}
          {!!s.tribe_name && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: tColor }} className="text-xs uppercase tracking-widest mb-2">
              {s.tribe_name}
            </Text>
          )}
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl uppercase tracking-tight">
            {s.name}
          </Text>
          {!!s.is_corporate_only && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-3 leading-relaxed">
              {corporateName
                ? `Private session for ${corporateName} — you're seeing this because you're on their team.`
                : `A private company session — you're seeing this because you're on the team.`}
            </Text>
          )}
        </View>

        {/* Status pill row — series score leads the row (founder:
            member feedback must be prominent when browsing). */}
        <View className="px-5 mt-4 flex-row flex-wrap gap-2">
          {s.series_rating_count > 0 && !!s.series_rating_avg && (
            <InfoPill
              label={`★ ${Number(s.series_rating_avg).toFixed(1)} · ${s.series_rating_count} rating${s.series_rating_count === 1 ? '' : 's'}`}
              accent={colors.warning}
            />
          )}
          <InfoPill label={dayHeader(s.scheduled_at)} />
          <InfoPill label={timeShort(s.scheduled_at)} />
          {!!s.city_name     && <InfoPill label={`📍 ${s.city_name}`} />}
          {!!s.activity_name && <InfoPill label={`${s.activity_icon || '•'} ${s.activity_name}`} />}
          <InfoPill label={priceLbl} accent={s.session_type === 'paid' ? colors.warning : colors.green} />
          {s.points_reward ? (
            <InfoPill
              label={earnsAtCheckin ? `+${s.points_reward} pts` : `+${s.points_reward} pts · Premium ⭐ or ${cfg.streak_double_threshold}-day streak`}
              accent={colors.green}
            />
          ) : null}
        </View>

        {/* Capacity bar — tap to see who's going */}
        {s.capacity != null && (
          <Pressable
            onPress={() => setShowWho(true)}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.99 : 1 }] })}
            className="px-5 mt-5 active:opacity-80"
          >
            <View className="bg-atp-dark rounded-full h-2 overflow-hidden">
              <View
                style={{
                  width: `${Math.min(100, (s.registrations_count / s.capacity) * 100)}%`,
                  backgroundColor: isFull ? colors.danger : colors.green,
                  height: '100%',
                }}
              />
            </View>
            <View className="flex-row items-center justify-between mt-2">
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                {isFull
                  ? `Full · ${s.waitlist_count} on waitlist`
                  : `${s.registrations_count}/${s.capacity} confirmed`}
              </Text>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
                See who's going →
              </Text>
            </View>
          </Pressable>
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

        {/* Member feedback for this session series — collapsed by
            default; the list is only fetched on first expand. */}
        <MemberFeedback sessionId={sessionId} count={s.series_rating_count} />

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

        {/* Check-in QR — only when the member has an active booking and the
            backend issued a qr_token (free + paid confirmed bookings get
            one; waitlist + cancelled don't). Ambassadors scan this at
            session start to mark attendance. */}
        {/* Post-session rating — backend only accepts feedback on
            status='attended' bookings (404 otherwise), so the block is
            gated on attendance rather than on the session being past. */}
        {myBooking?.status === 'attended' && (
          <FeedbackBlock bookingId={myBooking.id} coachName={s.coach_name} />
        )}

        {myBooking && (myBooking.qr_token || myBooking.qr_code) && myBooking.status !== 'cancelled' && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
              Your check-in QR
            </Text>
            <View className="bg-atp-white rounded-atp-lg p-5 items-center">
              <QRCode
                value={String(myBooking.qr_token || myBooking.qr_code)}
                size={200}
                backgroundColor="white"
                color="#0a0a0a"
              />
              <Text style={{ fontFamily: fontFamily.bodyBold, color: '#0a0a0a' }} className="text-xs uppercase tracking-widest mt-3">
                Show at check-in
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: '#666' }} className="text-xs mt-1 text-center">
                An ambassador will scan this to confirm your attendance
                {s.points_reward && earnsAtCheckin ? ` and credit +${s.points_reward} pts` : ''}.
              </Text>
            </View>
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
          <View>
            {s.status === 'upcoming' && (
              <SessionTerms accepted={termsOk} onToggle={setTermsOk} />
            )}
            <Pressable
              onPress={onBookPress}
              disabled={busy || s.status !== 'upcoming' || !termsOk}
              className={`rounded-atp py-4 items-center ${busy || s.status !== 'upcoming' || !termsOk ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
            >
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: (busy || s.status !== 'upcoming' || !termsOk) ? colors.muted : colors.black }}
                className="text-base"
              >
                {busy ? 'Booking…'
                  : s.status !== 'upcoming' ? 'Session closed'
                  : !termsOk ? 'Accept the terms to book'
                  : isFull ? 'Join waitlist'
                  : s.session_type === 'paid' ? 'Continue' : 'Reserve free spot'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Who's going */}
      <Modal visible={showWho} transparent animationType="slide" onRequestClose={() => setShowWho(false)}>
        <Pressable onPress={() => setShowWho(false)} className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <Pressable onPress={() => {}} className="bg-atp-black rounded-t-3xl border-t border-white/10" style={{ maxHeight: '75%' }}>
            <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-white/5">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
                Who's going
              </Text>
              <Pressable onPress={() => setShowWho(false)} hitSlop={10}>
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-lg">✕</Text>
              </Pressable>
            </View>
            {attendeesQ.isLoading ? (
              <ActivityIndicator color={colors.green} style={{ margin: 24 }} />
            ) : attendeesQ.isError ? (
              // A failed fetch must never masquerade as "nobody booked" —
              // that's exactly how a 500 hid a broken column (2026-09-15).
              <View className="px-5 py-8">
                <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-sm text-center">
                  Couldn't load the list.
                </Text>
                <Pressable onPress={() => attendeesQ.refetch()} className="mt-3 self-center px-4 py-2 rounded-atp border border-white/15 active:opacity-70">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest">
                    Try again
                  </Text>
                </Pressable>
              </View>
            ) : (attendeesQ.data || []).length === 0 ? (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm px-5 py-8 text-center">
                Nobody's booked yet — be the first.
              </Text>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
                {(attendeesQ.data || []).map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => { setShowWho(false); router.push(`/community/members/${a.id}`); }}
                    style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                    className="flex-row items-center gap-3 bg-atp-dark border border-white/5 rounded-atp-lg px-4 py-3 mb-2 active:opacity-80"
                  >
                    <Avatar uri={a.avatar_url} firstName={a.first_name} lastName={a.last_name} id={a.id} size="md" />
                    <View className="flex-1">
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
                        {`${a.first_name || ''} ${a.last_name || ''}`.trim() || 'ATP member'}
                      </Text>
                      {!!a.tribe_name && (
                        <Text
                          style={{ fontFamily: fontFamily.bodyBold, color: tribeColor(a.tribe_slug) }}
                          className="text-[10px] uppercase tracking-widest mt-0.5"
                        >
                          {a.tribe_name}
                        </Text>
                      )}
                    </View>
                    {a.status === 'attended' && (
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[10px] uppercase tracking-widest">
                        ✓ Attended
                      </Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

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

/**
 * Expandable "What members say" — rolling feedback across every session
 * sharing this one's name. Collapsed row + chevron; the feedback list
 * is fetched lazily on first expand and comment-less ratings are
 * skipped (they already count toward the pill's average).
 */
function MemberFeedback({ sessionId, count }: { sessionId: string; count: number }) {
  const [expanded, setExpanded] = useState(false);

  const feedbackQ = useQuery({
    queryKey: ['session-feedback', sessionId],
    queryFn:  () => getSessionFeedback(sessionId),
    enabled:  expanded && !!sessionId,
  });

  const rows = (feedbackQ.data?.feedback || []).filter((f) => !!f.comment);

  return (
    <View className="px-5 mt-6">
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        className="bg-atp-dark border border-white/5 rounded-atp-lg px-4 py-3.5 flex-row items-center active:opacity-70"
      >
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-sm mr-2">★</Text>
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1">
          What members say ({count})
        </Text>
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs">
          {expanded ? '▲' : '▼'}
        </Text>
      </Pressable>

      {expanded && (
        <View className="bg-atp-dark border border-white/5 rounded-atp-lg mt-2 px-4">
          {feedbackQ.isLoading ? (
            <View className="py-5 items-center">
              <ActivityIndicator color={colors.warning} />
            </View>
          ) : feedbackQ.isError ? (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm py-4">
              Couldn't load feedback — pull to refresh or try again later.
            </Text>
          ) : rows.length === 0 ? (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm py-4">
              No feedback yet — be the first after the session.
            </Text>
          ) : (
            rows.map((f, i) => (
              <View key={`${f.created_at}-${i}`} className={`py-3.5 ${i > 0 ? 'border-t border-white/5' : ''}`}>
                <View className="flex-row items-center">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning, letterSpacing: 2 }} className="text-xs">
                    {'★'.repeat(Math.max(1, Math.min(5, f.rating)))}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs ml-2 flex-1" numberOfLines={1}>
                    {f.first_name}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                    {dayHeader(f.session_at)}
                  </Text>
                </View>
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1.5 leading-relaxed">
                  {f.comment}
                </Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
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
