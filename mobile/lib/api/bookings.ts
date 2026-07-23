/**
 * Bookings API — wraps the v1.69 booking + payment endpoints.
 *
 * Booking lifecycle:
 *   createBooking(session)
 *     → free session         → 201 { booking, points_awarded }
 *     → paid session         → 200 { booking, status:'pending_payment', payment_options }
 *   payWithPoints(booking)   → 200 { booking, points_balance }
 *   startStripeCheckout(booking) → 200 { client_secret, ephemeral_key, customer }
 *                                  (mobile PaymentSheet)
 *   cancelBooking(booking)   → 204
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
  session_id?: number;
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
}

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

export interface CreateBookingResponse {
  booking: BookingRecord;
  status?: 'confirmed' | 'pending_payment' | 'waitlisted';
  points_awarded?: number;
  waitlist_position?: number;
  payment_options?: PaymentOptions;
}

export function createBooking(sessionId: number): Promise<CreateBookingResponse> {
  return api.post('/bookings', { session_id: sessionId });
}

export interface PayWithPointsResponse {
  booking: BookingRecord;
  points_balance: number;
  points_spent: number;
}

export function payWithPoints(bookingId: number): Promise<PayWithPointsResponse> {
  return api.post(`/bookings/${bookingId}/pay-with-points`);
}

export interface StripeCheckoutResponse {
  // For mobile PaymentSheet (paymentIntent flow)
  payment_intent_client_secret?: string;
  ephemeral_key?: string;
  customer_id?: string;
  publishable_key?: string;
  // For web Checkout Session fallback (we still surface the URL)
  checkout_url?: string;
}

export function startStripeCheckout(bookingId: number): Promise<StripeCheckoutResponse> {
  return api.post(`/bookings/${bookingId}/checkout`, { client: 'mobile' });
}

export function cancelBooking(bookingId: number): Promise<void> {
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
 * status='attended' (404 otherwise) and upserts with ON CONFLICT DO
 * NOTHING — resubmitting is a harmless 200, points are awarded once.
 */
export function submitSessionFeedback(
  bookingId: string | number,
  rating: number,
  comment?: string
): Promise<{ message: string }> {
  return api.post(`/bookings/${bookingId}/feedback`, { rating, comment: comment || null });
}
