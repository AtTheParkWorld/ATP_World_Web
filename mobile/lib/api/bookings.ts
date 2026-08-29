/**
 * Bookings API — wraps the v1.69 booking + payment endpoints.
 *
 * Booking lifecycle (real backend responses, audited 2026-08-30
 * against backend/src/routes/bookings.js):
 *   createBooking(session)
 *     → free session   → 201 { booking, qrData, qrToken }
 *                        (NO points here — points land at check-in)
 *     → paid session   → 202 { booking, status:'pending_payment', payment_options }
 *                        (200 with the same shape when resuming an
 *                         existing pending booking)
 *     → session full   → 202 { status:'waitlisted', position, message }
 *                        (NO booking row — mapped to waitlist_position)
 *   payWithPoints(booking)      → 200 { booking, qrData, qrToken, points_paid, points_balance }
 *   startStripeCheckout(booking)→ 200 { url, session_id }  (hosted Checkout)
 *   cancelBooking(booking)      → 200 { message, refund_status, ... }
 *
 * The screens just need to branch on `payment_options` to decide
 * whether to show the AED vs Points sheet, or skip straight to QR.
 */
import { api } from './client';

export interface BookingRecord {
  id: string | number;
  status: 'confirmed' | 'pending_payment' | 'cancelled' | 'attended' | 'waitlisted' | string;
  qr_code?: string | null;
  qr_token?: string | null;
  checked_in_at?: string | null;
  points_awarded?: number | null;
  created_at?: string;
  // sessions.id is a UUID — the backend sends a string, not a number.
  session_id?: string;
  session_name?: string;
  scheduled_at?: string;
  location?: string | null;
  location_maps_url?: string | null;
  session_type?: string;
  description?: string | null;
  duration_mins?: number | null;
  capacity?: number | null;
  tribe_name?: string | null;
  tribe_color?: string | null;
  city_name?: string | null;
  // /members/bookings also joins corporate_accounts for private
  // company sessions.
  is_corporate_only?: boolean;
  corporate_account_id?: string | null;
  corporate_company_name?: string | null;
}

/**
 * Client-facing payment options. The wire payload from
 * _sessionPricing() uses different names — `accepts_stripe` and
 * `currency_price` — which mapPaymentOptions() below maps onto the
 * `accepts_money` / `money_price` names the screens render.
 * (Audit 2026-08-30: the screens previously read accepts_money /
 * money_price straight off the payload, which never carried them, so
 * the card button could never render.)
 */
export interface PaymentOptions {
  is_paid: boolean;
  accepts_money: boolean;
  accepts_points: boolean;
  money_price: number | null;
  points_price: number | null;
  currency_code: string | null;
  points_balance: number;
  can_afford_points: boolean;
}

// Exactly what POST /bookings puts in `payment_options`:
// { ..._sessionPricing(session), points_balance, can_afford_points }.
interface RawPaymentOptions {
  is_paid: boolean;
  points_price: number;
  currency_price: number;
  currency_code: string;
  accepts_points: boolean;
  accepts_stripe: boolean;
  points_balance: number;
  can_afford_points: boolean;
}

function mapPaymentOptions(raw: RawPaymentOptions): PaymentOptions {
  return {
    is_paid:           raw.is_paid,
    accepts_money:     raw.accepts_stripe,
    accepts_points:    raw.accepts_points,
    money_price:       raw.currency_price > 0 ? raw.currency_price : null,
    points_price:      raw.points_price > 0 ? raw.points_price : null,
    currency_code:     raw.currency_code || null,
    points_balance:    raw.points_balance || 0,
    can_afford_points: !!raw.can_afford_points,
  };
}

/**
 * Discriminated on `status`:
 *  - undefined            → free session confirmed (201)
 *  - 'pending_payment'    → paid session, pick points vs card (200/202)
 *  - 'waitlisted'         → full, no booking row exists (202)
 * `waitlist_position` is mapped from the backend's `position` field.
 * (Audit 2026-08-30: removed the phantom `points_awarded` — the free
 * path never sends it; attendance points are granted at check-in.)
 */
export type CreateBookingResponse =
  | {
      status?: undefined;
      booking: BookingRecord;
      qrData: string;
      qrToken: string;
      payment_options?: undefined;
      waitlist_position?: undefined;
      message?: undefined;
    }
  | {
      status: 'pending_payment';
      booking: BookingRecord;
      payment_options: PaymentOptions;
      qrData?: undefined;
      qrToken?: undefined;
      waitlist_position?: undefined;
      message?: undefined;
    }
  | {
      status: 'waitlisted';
      waitlist_position: number;
      message: string;
      booking?: undefined;
      payment_options?: undefined;
      qrData?: undefined;
      qrToken?: undefined;
    };

export async function createBooking(sessionId: string | number): Promise<CreateBookingResponse> {
  interface RawCreateBooking {
    booking?: BookingRecord;
    status?: 'pending_payment' | 'waitlisted';
    position?: number;          // waitlist only — mapped to waitlist_position
    message?: string;           // waitlist only
    qrData?: string;            // free-confirm only
    qrToken?: string;           // free-confirm only
    payment_options?: RawPaymentOptions;
  }
  const res = await api.post<RawCreateBooking>('/bookings', { session_id: sessionId });

  if (res.status === 'waitlisted') {
    return {
      status: 'waitlisted',
      waitlist_position: Number(res.position) || 0,
      message: res.message || 'Session is full. You are on the waiting list.',
    };
  }
  if (!res.booking) {
    // Defensive: every non-waitlist success path carries a booking row.
    throw new Error('Booking service returned an unexpected response. Pull to refresh and check My Bookings.');
  }
  if (res.status === 'pending_payment' && res.payment_options) {
    return {
      status: 'pending_payment',
      booking: res.booking,
      payment_options: mapPaymentOptions(res.payment_options),
    };
  }
  return { booking: res.booking, qrData: res.qrData || '', qrToken: res.qrToken || '' };
}

/**
 * Real payload: { booking, qrData, qrToken, points_paid, points_balance }.
 * (Audit 2026-08-30: the field is `points_paid`, not the previously
 * declared phantom `points_spent`.)
 */
export interface PayWithPointsResponse {
  booking: BookingRecord;
  qrData: string;
  qrToken: string;
  points_paid: number;
  points_balance: number;
}

export function payWithPoints(bookingId: string | number): Promise<PayWithPointsResponse> {
  return api.post(`/bookings/${bookingId}/pay-with-points`);
}

/**
 * Real payload of POST /bookings/:id/checkout: { url, session_id } —
 * a HOSTED Stripe Checkout link (mode:'payment') meant for a browser
 * redirect; payment confirmation arrives via webhook.
 *
 * BACKEND-GAP (audit 2026-08-30): there is no PaymentIntent +
 * ephemeral-key endpoint, so the previously declared PaymentSheet
 * fields (payment_intent_client_secret / ephemeral_key / customer_id /
 * publishable_key / checkout_url) were phantoms — none is ever sent.
 * The native PaymentSheet cannot work until the backend adds one.
 */
export interface StripeCheckoutResponse {
  url: string;
  session_id: string;
}

export function startStripeCheckout(bookingId: string | number): Promise<StripeCheckoutResponse> {
  return api.post(`/bookings/${bookingId}/checkout`, { client: 'mobile' });
}

/**
 * Real payload of DELETE /bookings/:id — 200 with a refund summary
 * (not 204 as previously documented): cancellations always succeed,
 * refunds only issue when cancelling >12h before start.
 */
export interface CancelBookingResponse {
  message: string;
  refund_status: 'none' | 'refunded' | 'forfeited_outside_window' | 'not_paid' | 'failed' | string;
  refund_method: 'points' | 'stripe' | null;
  refunded_points: number;
  refunded_amount: number;
  refunded_currency: string;
  within_12h: boolean;
  forced: boolean;
  stripe_refund_error?: string | null;
}

export function cancelBooking(bookingId: string | number): Promise<CancelBookingResponse> {
  return api.delete(`/bookings/${bookingId}`);
}

export interface MyBookingsResponse {
  bookings: BookingRecord[];
}

export function listMyBookings(): Promise<MyBookingsResponse> {
  return api.get('/members/bookings');
}

/**
 * Post-session rating. Backend only accepts feedback on bookings with
 * status='attended' (404 otherwise) and upserts — resubmitting is a
 * harmless 200, points are awarded once.
 *
 * `opts.coach_rating` (1-5, optional) additionally scores the session's
 * coach and flows into the coach's public average.
 */
export function submitSessionFeedback(
  bookingId: string | number,
  rating: number,
  comment?: string,
  opts?: { coach_rating?: number }
): Promise<{ message: string }> {
  return api.post(`/bookings/${bookingId}/feedback`, {
    rating,
    comment: comment || null,
    ...(opts?.coach_rating ? { coach_rating: opts.coach_rating } : {}),
  });
}
