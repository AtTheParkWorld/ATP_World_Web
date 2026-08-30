/**
 * Coach dashboard — entry hub. Surfaces:
 *  - 1:1 booking REQUESTS (card hold placed by a member; confirm within
 *    72h to capture the charge, or decline with a reason to release it)
 *  - "Confirm attendance" on confirmed 1:1s whose time has passed
 *  - Earnings card (upcoming / accrued / settled / lifetime + rows)
 *  - Unread visitor message count (red badge) → /coach/threads
 *  - Wallet balance + pending payouts → /coach/wallet
 *  - Quick links to upcoming sessions, public profile preview
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyCoachThreads, getMyWallet, listMyOfferings } from '@/lib/api/coach';
import { deleteCoachFeedback, getCoach, type CoachFeedback } from '@/lib/api/coaches';
import {
  coachCompleteBooking, coachConfirmBooking, coachDeclineBooking,
  getMyCoachEarnings, listMyCoachSessionBookings,
  type CoachSessionBooking,
} from '@/lib/api/coachSessions';
import { listSessions } from '@/lib/api/sessions';
import { useAuthStore } from '@/lib/stores/auth.store';
import { LoadError } from '@/lib/components/LoadError';
import { colors, fontFamily } from '@/lib/theme/tokens';

/** Earnings-row state → chip colour. upcoming=white, accrued=lime, settled=muted. */
function earningsChipColor(state: string): string {
  const s = String(state || '').toLowerCase();
  if (s === 'settled' || s === 'paid' || s === 'paid_out') return colors.muted;
  if (s === 'accrued' || s === 'earned' || s === 'completed') return colors.green;
  return colors.white; // upcoming / confirmed / pending_coach
}

function aed(n: number | undefined | null): string {
  return Number(n || 0).toLocaleString();
}

export default function CoachIndex() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const coachId = String(me?.id || '');

  const threadsQ = useQuery({
    queryKey: ['coach-threads', coachId],
    queryFn:  () => listMyCoachThreads(coachId),
    enabled:  !!coachId,
    refetchInterval: 30_000,
  });
  const walletQ = useQuery({
    queryKey: ['coach-wallet'],
    queryFn:  () => getMyWallet(),
    enabled:  !!coachId,
  });
  const offeringsQ = useQuery({
    queryKey: ['coach-offerings'],
    queryFn:  () => listMyOfferings().then(r => r.offerings),
    enabled:  !!coachId,
  });
  // Coach's upcoming sessions — backend filter is by coach_id which the
  // list endpoint accepts directly via city/activity not coach; we
  // fetch all upcoming and filter client-side. Small list, fine.
  const sessionsQ = useQuery({
    queryKey: ['sessions', 'upcoming'],
    queryFn:  () => listSessions({ status: 'upcoming', limit: 100 }).then(r => r.sessions),
  });
  const mySessions = (sessionsQ.data || []).filter((s) => s.coach_id === coachId);

  // 1:1 bookings — /me/bookings returns both roles; keep only the ones
  // where I'm the coach. pending_coach = member's card hold is waiting
  // on me; confirmed + past end time = ready for attendance confirmation.
  const bookingsQ = useQuery({
    queryKey: ['coach-session-bookings'],
    queryFn:  () => listMyCoachSessionBookings().then(r => r.bookings),
    enabled:  !!coachId,
    refetchInterval: 60_000,
  });
  const earningsQ = useQuery({
    queryKey: ['coach-earnings'],
    queryFn:  () => getMyCoachEarnings(),
    enabled:  !!coachId,
  });
  // My public feedback — same query key as the public /coaches/[id] screen
  // so the two stay in sync after a delete.
  const feedbackQ = useQuery({
    queryKey: ['coach', coachId],
    queryFn:  () => getCoach(coachId),
    enabled:  !!coachId,
  });
  const myFeedback = feedbackQ.data?.feedback || [];

  const myBookings = (bookingsQ.data || []).filter((b) => String(b.coach_id) === coachId);
  const requests   = myBookings.filter((b) => b.status === 'pending_coach');
  const completables = myBookings.filter((b) => {
    if (b.status !== 'confirmed' || !b.scheduled_at) return false;
    const end = new Date(b.scheduled_at).getTime() + (Number(b.duration_min) || 60) * 60_000;
    return end < Date.now();
  });

  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<CoachSessionBooking | null>(null);
  const [deletingFbId, setDeletingFbId] = useState<string | null>(null);

  /** Soft-delete one feedback row (comment goes, star score stays). */
  function onDeleteFeedback(f: CoachFeedback) {
    Alert.alert(
      'Remove this feedback?',
      'The comment will be removed but the star rating still counts toward your average.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeletingFbId(f.id);
            try {
              await deleteCoachFeedback(coachId, f.id);
              await qc.invalidateQueries({ queryKey: ['coach', coachId] });
            } catch (err) {
              Alert.alert('Could not remove', (err as Error).message || 'Try again.');
            } finally {
              setDeletingFbId(null);
            }
          },
        },
      ]
    );
  }

  /** Optimistically drop the booking from the cached list, then refetch. */
  function settleBooking(id: string, nextStatus: string) {
    qc.setQueryData<CoachSessionBooking[]>(['coach-session-bookings'], (prev) =>
      (prev || []).map((b) => (b.id === id ? { ...b, status: nextStatus } : b))
    );
    qc.invalidateQueries({ queryKey: ['coach-session-bookings'] });
    qc.invalidateQueries({ queryKey: ['coach-earnings'] });
    qc.invalidateQueries({ queryKey: ['coach-wallet'] });
  }

  async function onConfirm(b: CoachSessionBooking) {
    if (busyBookingId) return;
    setBusyBookingId(b.id);
    try {
      await coachConfirmBooking(b.id);
      settleBooking(b.id, 'confirmed');
    } catch (err) {
      Alert.alert('Could not confirm', (err as Error).message || 'Try again.');
    } finally {
      setBusyBookingId(null);
    }
  }

  async function onDecline(b: CoachSessionBooking, reason: string) {
    setDeclining(null);
    setBusyBookingId(b.id);
    try {
      await coachDeclineBooking(b.id, reason);
      settleBooking(b.id, 'declined');
    } catch (err) {
      Alert.alert('Could not decline', (err as Error).message || 'Try again.');
    } finally {
      setBusyBookingId(null);
    }
  }

  async function onComplete(b: CoachSessionBooking) {
    if (busyBookingId) return;
    setBusyBookingId(b.id);
    try {
      await coachCompleteBooking(b.id);
      settleBooking(b.id, 'completed');
    } catch (err) {
      Alert.alert('Could not mark complete', (err as Error).message || 'Try again.');
    } finally {
      setBusyBookingId(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Coach
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={threadsQ.isFetching || walletQ.isFetching || sessionsQ.isFetching || bookingsQ.isFetching || earningsQ.isFetching}
            onRefresh={async () => {
              await Promise.all([
                qc.invalidateQueries({ queryKey: ['coach-threads'] }),
                qc.invalidateQueries({ queryKey: ['coach-wallet'] }),
                qc.invalidateQueries({ queryKey: ['coach-offerings'] }),
                qc.invalidateQueries({ queryKey: ['coach-session-bookings'] }),
                qc.invalidateQueries({ queryKey: ['coach-earnings'] }),
                qc.invalidateQueries({ queryKey: ['coach', coachId] }),
                qc.invalidateQueries({ queryKey: ['sessions'] }),
              ]);
            }}
          />
        }
      >
        {/* Greeting */}
        <View className="px-5 pt-4">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
            Welcome back,
          </Text>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight mt-1">
            Coach {me?.first_name}
          </Text>
        </View>

        {/* Stat strip */}
        <View className="px-5 mt-5 flex-row gap-3">
          <StatTile
            label="Unread DMs"
            value={String(threadsQ.data?.unread_messages ?? 0)}
            accent={threadsQ.data?.unread_messages ? colors.danger : colors.muted}
          />
          <StatTile
            label="Wallet (AED)"
            value={walletQ.data ? aed(walletQ.data.balance_aed) : '—'}
            accent={colors.green}
          />
          <StatTile
            label="Upcoming"
            value={String(mySessions.length)}
            accent={colors.white}
          />
        </View>

        {/* 1:1 booking requests — card hold waiting on the coach */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            Requests{requests.length > 0 ? ` (${requests.length})` : ''}
          </Text>
          {bookingsQ.isError ? (
            <LoadError onRetry={() => bookingsQ.refetch()} message="Couldn't load booking requests" />
          ) : bookingsQ.isLoading ? (
            <ActivityIndicator color={colors.green} />
          ) : requests.length === 0 ? (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              No pending 1:1 requests. New requests hold the member's card until you confirm.
            </Text>
          ) : (
            requests.map((b) => (
              <View key={b.id} className="bg-atp-dark border border-atp-green/30 rounded-atp p-4 mb-2">
                <View className="flex-row items-center justify-between">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1 pr-3">
                    {b.member_first_name || 'Member'} · {b.offering_title || '1:1 session'}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green, fontVariant: ['tabular-nums'] }} className="text-sm">
                    AED {aed(b.price_aed)}
                  </Text>
                </View>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
                  {b.scheduled_at ? new Date(b.scheduled_at).toLocaleString() : 'Time TBC'} · {b.duration_min} min
                </Text>
                {!!b.member_note && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-2 italic" numberOfLines={3}>
                    "{b.member_note}"
                  </Text>
                )}
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-2">
                  Card hold placed — confirm within 72h to charge, or the hold is released.
                </Text>
                <View className="flex-row gap-2 mt-3">
                  <Pressable
                    onPress={() => onConfirm(b)}
                    disabled={busyBookingId !== null}
                    className="flex-1 rounded-atp py-2.5 items-center bg-atp-green active:opacity-80"
                  >
                    {busyBookingId === b.id
                      ? <ActivityIndicator color={colors.black} size="small" />
                      : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">Confirm</Text>}
                  </Pressable>
                  <Pressable
                    onPress={() => setDeclining(b)}
                    disabled={busyBookingId !== null}
                    className="flex-1 rounded-atp py-2.5 items-center bg-atp-dark-3 border border-white/10 active:opacity-70"
                  >
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-xs uppercase tracking-widest">Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Confirmed 1:1s past their time — confirm attendance to complete */}
        {completables.length > 0 && (
          <View className="px-5 mt-7">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
              Awaiting attendance
            </Text>
            {completables.map((b) => (
              <View key={b.id} className="bg-atp-dark border border-white/5 rounded-atp p-4 mb-2">
                <View className="flex-row items-center justify-between">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1 pr-3">
                    {b.member_first_name || 'Member'} · {b.offering_title || '1:1 session'}
                  </Text>
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white, fontVariant: ['tabular-nums'] }} className="text-sm">
                    AED {aed(b.price_aed)}
                  </Text>
                </View>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
                  {b.scheduled_at ? new Date(b.scheduled_at).toLocaleString() : ''} · {b.duration_min} min
                </Text>
                <Pressable
                  onPress={() => onComplete(b)}
                  disabled={busyBookingId !== null}
                  className="mt-3 rounded-atp py-2.5 items-center bg-atp-green/15 border border-atp-green/50 active:opacity-80"
                >
                  {busyBookingId === b.id
                    ? <ActivityIndicator color={colors.green} size="small" />
                    : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">Confirm attendance</Text>}
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Earnings */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            Earnings
          </Text>
          {earningsQ.isError ? (
            <LoadError onRetry={() => earningsQ.refetch()} message="Couldn't load earnings" />
          ) : earningsQ.isLoading ? (
            <ActivityIndicator color={colors.green} />
          ) : (
            <View className="bg-atp-dark rounded-atp-lg border border-white/5 p-4">
              <View className="flex-row">
                <EarningsTotal label="Upcoming" value={earningsQ.data?.upcoming_aed} color={colors.white} />
                <EarningsTotal label="Accrued"  value={earningsQ.data?.accrued_aed}  color={colors.green} />
              </View>
              <View className="flex-row mt-4">
                <EarningsTotal label="Settled"  value={earningsQ.data?.settled_aed}  color={colors.muted} />
                <EarningsTotal label="Lifetime" value={earningsQ.data?.lifetime_aed} color={colors.white} />
              </View>

              {(earningsQ.data?.rows || []).length > 0 && (
                <View className="mt-5 border-t border-white/5 pt-3">
                  {(earningsQ.data?.rows || []).map((r) => {
                    const chip = earningsChipColor(r.state);
                    return (
                      <View key={r.id} className="flex-row items-center py-2">
                        <View className="flex-1 pr-2">
                          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs" numberOfLines={1}>
                            {r.member_first_name || 'Member'}
                          </Text>
                          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-0.5">
                            {r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : ''}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white, fontVariant: ['tabular-nums'] }} className="text-xs mr-3">
                          AED {aed(r.coach_share_aed)}
                        </Text>
                        <View style={{ borderColor: chip }} className="border rounded-full px-2 py-0.5">
                          <Text style={{ fontFamily: fontFamily.bodyBold, color: chip }} className="text-[10px] uppercase tracking-widest">
                            {String(r.state || '').replace(/_/g, ' ')}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </View>

        {/* My feedback — what members see on my public profile */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            My feedback{myFeedback.length > 0 ? ` (${myFeedback.length})` : ''}
          </Text>
          {feedbackQ.isError ? (
            <LoadError onRetry={() => feedbackQ.refetch()} message="Couldn't load feedback" />
          ) : feedbackQ.isLoading ? (
            <ActivityIndicator color={colors.green} />
          ) : myFeedback.length === 0 ? (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              No feedback yet. Members can rate you from your public profile.
            </Text>
          ) : (
            myFeedback.map((f) => (
              <View key={f.id} className="bg-atp-dark border border-white/5 rounded-atp p-4 mb-2">
                <View className="flex-row items-center">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center">
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-shrink pr-2" numberOfLines={1}>
                        {`${f.first_name || 'Member'} ${f.last_name || ''}`.trim()}
                      </Text>
                      <Text style={{ fontSize: 12, letterSpacing: 1 }}>
                        <Text style={{ color: colors.green }}>{'★'.repeat(Math.max(0, Math.min(5, Math.round(f.rating))))}</Text>
                        <Text style={{ color: colors.muted }}>{'☆'.repeat(5 - Math.max(0, Math.min(5, Math.round(f.rating))))}</Text>
                      </Text>
                    </View>
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-0.5">
                      {new Date(f.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => onDeleteFeedback(f)}
                    disabled={deletingFbId !== null}
                    hitSlop={8}
                    className="w-7 h-7 rounded-full bg-atp-dark-3 border border-white/10 items-center justify-center active:opacity-70"
                  >
                    {deletingFbId === f.id
                      ? <ActivityIndicator color={colors.muted} size="small" />
                      : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted, fontSize: 13, lineHeight: 15 }}>×</Text>}
                  </Pressable>
                </View>
                {!!f.comment && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-2 leading-relaxed">
                    {f.comment}
                  </Text>
                )}
              </View>
            ))
          )}
        </View>

        {/* Quick actions */}
        <View className="px-5 mt-7 gap-2">
          <LinkRow
            label="Inquiries"
            emoji="📨"
            badge={Number(threadsQ.data?.unread_threads ?? 0)}
            onPress={() => router.push('/coach/threads')}
          />
          <LinkRow
            label="Wallet + payouts"
            emoji="💰"
            onPress={() => router.push('/coach/wallet')}
          />
          <LinkRow
            label="My offerings"
            emoji="📋"
            subtitle={offeringsQ.data ? `${offeringsQ.data.length} active` : undefined}
            onPress={() => router.push('/coach/offerings')}
          />
          <LinkRow
            label="Edit my coach profile"
            emoji="✏️"
            subtitle="Photos, bio, specialties, links"
            onPress={() => router.push('/coach/profile')}
          />
          <LinkRow
            label="My public profile"
            emoji="👤"
            onPress={() => router.push(`/coaches/${coachId}`)}
          />
        </View>

        {/* Upcoming sessions */}
        <View className="px-5 mt-7">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
            Your upcoming sessions
          </Text>
          {sessionsQ.isLoading ? (
            <ActivityIndicator color={colors.green} />
          ) : mySessions.length === 0 ? (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
              No sessions scheduled. The admin assigns sessions in the CMS.
            </Text>
          ) : (
            mySessions.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => router.push(`/sessions/${s.id}`)}
                className="bg-atp-dark border border-white/5 rounded-atp p-3 mb-2 active:opacity-70"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                  {s.name}
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                  {new Date(s.scheduled_at).toLocaleString()} · {s.registrations_count}{s.capacity ? `/${s.capacity}` : ''} booked
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      {declining && (
        <DeclineModal
          booking={declining}
          onCancel={() => setDeclining(null)}
          onSubmit={(reason) => onDecline(declining, reason)}
        />
      )}
    </SafeAreaView>
  );
}

/** Reason prompt for declining a 1:1 request (Alert.prompt is iOS-only). */
function DeclineModal({ booking, onCancel, onSubmit }: {
  booking:  CoachSessionBooking;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal animationType="slide" transparent visible onRequestClose={onCancel}>
      <Pressable onPress={onCancel} className="flex-1 bg-black/70 justify-end">
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View className="bg-atp-dark rounded-t-3xl pt-3 pb-9 px-5 border-t border-white/10">
            <View className="self-center w-12 h-1 bg-white/20 rounded-full mb-4" />
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
              Decline request
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-1">
              {booking.member_first_name || 'The member'}'s card hold will be released. Let them know why.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. I'm not available at that time — try Thursday"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={300}
              autoFocus
              style={{ fontFamily: fontFamily.body, color: colors.white, minHeight: 64, textAlignVertical: 'top' }}
              className="bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-3 text-sm mt-4"
            />
            <Pressable
              onPress={() => reason.trim() && onSubmit(reason.trim())}
              disabled={!reason.trim()}
              className={`mt-4 rounded-atp py-3.5 items-center ${reason.trim() ? 'bg-atp-red active:opacity-80' : 'bg-atp-dark-3'}`}
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: reason.trim() ? colors.white : colors.muted }} className="text-sm uppercase tracking-widest">
                Decline &amp; release hold
              </Text>
            </Pressable>
            <Pressable onPress={onCancel} className="mt-2 py-3 items-center">
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">Keep request</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EarningsTotal({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  return (
    <View className="flex-1">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
        {label}
      </Text>
      <Text style={{ fontFamily: fontFamily.displayBlack, color, fontVariant: ['tabular-nums'] }} className="text-xl mt-0.5">
        AED {aed(value)}
      </Text>
    </View>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View className="flex-1 bg-atp-dark rounded-atp-lg border border-white/5 p-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
        {label}
      </Text>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: accent }} className="text-2xl mt-1">
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ label, emoji, subtitle, badge, onPress }: { label: string; emoji: string; subtitle?: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-atp-dark border border-white/5 rounded-atp px-4 py-3.5 active:opacity-70"
    >
      <Text style={{ fontSize: 20, marginRight: 12 }}>{emoji}</Text>
      <View className="flex-1">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
          {label}
        </Text>
        {!!subtitle && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
            {subtitle}
          </Text>
        )}
      </View>
      {badge && badge > 0 ? (
        <View className="bg-atp-red rounded-full min-w-[22px] h-[22px] items-center justify-center px-2 mr-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">{badge}</Text>
        </View>
      ) : null}
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}>›</Text>
    </Pressable>
  );
}
