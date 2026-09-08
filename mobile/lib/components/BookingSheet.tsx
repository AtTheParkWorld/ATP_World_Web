/**
 * Booking payment sheet — appears after the user taps "Continue" on a
 * paid session and the backend returns payment_options.
 *
 * Two payment paths:
 *   1) Pay with points     → POST /bookings/:id/pay-with-points
 *      (instant confirmation, no Stripe involved)
 *   2) Pay with card (AED) → POST /bookings/:id/checkout
 *      → backend returns a HOSTED Stripe Checkout url
 *      → we open it in the in-app browser, then confirm the booking
 *        against the server once it closes (founder 2026-08-30: this
 *        path used to fetch the url, throw it away and tell the member
 *        card payment was unavailable). Stripe's WEBHOOK is what marks
 *        the booking paid, so we poll rather than trust the redirect.
 *
 * On either success we call onSuccess() so the parent screen can
 * invalidate queries + show "you're in".
 *
 * Cancellation: tapping outside the sheet or the X closes WITHOUT
 * deleting the pending_payment booking — backend keeps it around for
 * 30 minutes so the user can resume mid-flow.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { payWithPoints, startStripeCheckout, getBookingStatus, type PaymentOptions, type BookingRecord } from '@/lib/api/bookings';
import { WEB_BASE } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';

/** Wait for the Stripe webhook to mark the booking paid. The browser
 *  closing tells us nothing — the member may have paid, abandoned, or
 *  swiped away mid-3DS — so the server is the only honest answer. */
async function waitForPayment(bookingId: string | number): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const st = await getBookingStatus(bookingId);
      if (st.is_paid) return true;
    } catch {
      // transient — keep trying within the budget
    }
    await new Promise((r) => setTimeout(r, attempt === 0 ? 800 : 1500));
  }
  return false;
}

interface Props {
  booking: BookingRecord;
  opts:    PaymentOptions;
  onClose: () => void;
  onSuccess: () => void;
}

export function BookingSheet({ booking, opts, onClose, onSuccess }: Props) {
  const [busy,  setBusy]  = useState<'points' | 'card' | null>(null);

  async function onPayPoints() {
    if (!opts.accepts_points || !opts.can_afford_points) return;
    setBusy('points');
    try {
      await payWithPoints(booking.id);
      onSuccess();
    } catch (err) {
      Alert.alert('Points payment failed', (err as Error).message || 'Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function onPayCard() {
    if (!opts.accepts_money) return;
    setBusy('card');
    try {
      // Hosted Stripe Checkout in the in-app browser. Both return URLs
      // land on /booking-return.html — a tiny login-free page built for
      // this sheet, rather than the full profile screen.
      const res = await startStripeCheckout(booking.id, {
        success_url: `${WEB_BASE}/booking-return.html?status=success`,
        cancel_url:  `${WEB_BASE}/booking-return.html?status=cancel`,
      });
      if (!res?.url) throw new Error('Checkout link missing. Please try again.');

      await WebBrowser.openBrowserAsync(res.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        dismissButtonStyle: 'close',
        toolbarColor: colors.black,
        controlsColor: colors.green,
      });

      // The browser closing proves nothing — ask the server.
      const paid = await waitForPayment(booking.id);
      if (paid) {
        onSuccess();
      } else {
        Alert.alert(
          'Payment not confirmed',
          "We haven't received confirmation from your bank yet. If you completed the payment it'll appear in My Bookings shortly — otherwise your spot is still held, so you can try again."
        );
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      Alert.alert(
        'Card payment failed',
        /network|fetch/i.test(msg)
          ? 'Connection lost while opening checkout. Check your signal and try again.'
          : msg || 'Try again.'
      );
    } finally {
      setBusy(null);
    }
  }

  const moneyLabel = opts.money_price != null
    ? `${opts.currency_code || 'AED'} ${opts.money_price}`
    : 'Card';

  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/70 justify-end">
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View className="bg-atp-dark rounded-t-3xl pt-3 pb-9 px-5 border-t border-white/10">
            <View className="self-center w-12 h-1 bg-white/20 rounded-full mb-4" />
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
              Pay for this session
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-1">
              Pick how you'd like to pay.
            </Text>

            <View className="mt-5 gap-3">
              {opts.accepts_points && (
                <Pressable
                  onPress={onPayPoints}
                  disabled={!opts.can_afford_points || busy !== null}
                  className={`rounded-atp p-4 border ${
                    opts.can_afford_points
                      ? 'bg-atp-green/15 border-atp-green/50 active:opacity-80'
                      : 'bg-atp-dark-3 border-white/5'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
                        Pay with points
                      </Text>
                      <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-0.5">
                        {opts.points_price} pts · balance {opts.points_balance.toLocaleString()}
                      </Text>
                    </View>
                    {busy === 'points'
                      ? <ActivityIndicator color={colors.green} />
                      : opts.can_afford_points
                        ? <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">USE</Text>
                        : <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                            Not enough
                          </Text>}
                  </View>
                </Pressable>
              )}

              {opts.accepts_money && (
                <Pressable
                  onPress={onPayCard}
                  disabled={busy !== null}
                  className="rounded-atp p-4 border bg-atp-dark-3 border-white/10 active:opacity-80"
                >
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
                        Pay with card
                      </Text>
                      <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-0.5">
                        {moneyLabel}
                      </Text>
                    </View>
                    {busy === 'card'
                      ? <ActivityIndicator color={colors.white} />
                      : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">PAY</Text>}
                  </View>
                </Pressable>
              )}
            </View>

            <Pressable onPress={onClose} className="mt-4 py-3 items-center">
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                Not now
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
