/**
 * Booking payment sheet — appears after the user taps "Continue" on a
 * paid session and the backend returns payment_options.
 *
 * Two payment paths:
 *   1) Pay with points     → POST /bookings/:id/pay-with-points
 *      (instant confirmation, no Stripe involved)
 *   2) Pay with card (AED) → POST /bookings/:id/checkout?client=mobile
 *      → backend returns a PaymentIntent client_secret + ephemeralKey
 *      → we present Stripe's PaymentSheet
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
import { useStripe } from '@stripe/stripe-react-native';
import { payWithPoints, startStripeCheckout, type PaymentOptions, type BookingRecord } from '@/lib/api/bookings';
import { colors, fontFamily } from '@/lib/theme/tokens';

interface Props {
  booking: BookingRecord;
  opts:    PaymentOptions;
  onClose: () => void;
  onSuccess: () => void;
}

export function BookingSheet({ booking, opts, onClose, onSuccess }: Props) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
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
      const res = await startStripeCheckout(booking.id);
      if (!res.payment_intent_client_secret) {
        Alert.alert(
          'Card payment unavailable',
          'Stripe is not configured for mobile. Please contact ATP support.'
        );
        return;
      }
      const init = await initPaymentSheet({
        merchantDisplayName:    'ATP — At The Park',
        paymentIntentClientSecret: res.payment_intent_client_secret,
        customerEphemeralKeySecret: res.ephemeral_key,
        customerId:                res.customer_id,
        defaultBillingDetails:     {},
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
        return;
      }
      onSuccess();
    } catch (err) {
      Alert.alert('Card payment failed', (err as Error).message || 'Try again.');
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
