/**
 * Coach 1-on-1 sessions API.
 *
 * Member side:
 *   - getPublicOfferings(coachId)  → active offerings + weekly availability
 *   - bookCoachSessionWithCard()   → POST /coach-sessions/book with
 *     payment:'card'. Backend creates a MANUAL-CAPTURE PaymentIntent and
 *     returns the PaymentSheet trio (client secret + ephemeral key +
 *     customer id) — same shape as the group-session checkout. The card
 *     is only AUTHORIZED at this point; capture happens when the coach
 *     confirms (coach-confirm endpoint), so UI copy must say "hold
 *     placed", never "paid".
 *
 * Coach side:
 *   - listMyCoachSessionBookings() → bookings I'm involved in (filter by
 *     coach_id === me client-side for the Requests section)
 *   - coachConfirmBooking(id)      → captures the member's card hold
 *   - coachDeclineBooking(id, r)   → releases the hold
 *   - coachCompleteBooking(id)     → marks attendance after the session
 *   - getMyCoachEarnings()         → four totals + per-booking rows
 *
 * Booking states: pending_coach | confirmed | declined | expired |
 * payment_failed | completed.
 */
import { api } from './client';

// ── Public offerings (member-facing coach profile) ───────────────

export interface PublicCoachOffering {
  id:           string;
  title:        string;
  description:  string | null;
  duration_min: number;
  price_aed:    number;
  sort_order?:  number;
}

export interface CoachAvailabilityWindow {
  /** 0 = Sunday … 6 = Saturday (matches JS Date#getDay). */
  day_of_week: number;
  start_time:  string; // 'HH:MM' or 'HH:MM:SS'
  end_time:    string;
  timezone:    string;
}

export function getPublicOfferings(coachId: string): Promise<{
  offerings:    PublicCoachOffering[];
  availability: CoachAvailabilityWindow[];
}> {
  return api.get(`/coach-sessions/public/${coachId}/offerings`);
}

// ── Bookings ─────────────────────────────────────────────────────

export type CoachBookingState =
  | 'pending_coach'
  | 'confirmed'
  | 'declined'
  | 'expired'
  | 'payment_failed'
  | 'completed'
  | string; // tolerate legacy / transitional states

export interface CoachSessionBooking {
  id:           string;
  offering_id:  string;
  coach_id:     string;
  member_id:    string;
  payer_id?:    string;
  scheduled_at: string | null;
  duration_min: number;
  price_aed:    number;
  status:       CoachBookingState;
  member_note?: string | null;
  created_at?:  string;
  // Joined display fields from GET /coach-sessions/me/bookings
  offering_title?:    string;
  coach_first_name?:  string;
  coach_last_name?:   string;
  member_first_name?: string;
  member_last_name?:  string;
}

/** PaymentSheet trio — identical shape to the group-session checkout. */
export interface CardHoldPayment {
  payment_intent_client_secret: string;
  ephemeral_key:                string;
  customer_id:                  string;
}

/**
 * Book a 1:1 slot with a card hold. The returned intent is
 * manual-capture: presentPaymentSheet success == hold placed, NOT paid.
 */
export function bookCoachSessionWithCard(input: {
  offering_id:  string;
  scheduled_at: string; // ISO datetime
  member_note?: string;
}): Promise<{ booking: CoachSessionBooking; payment: CardHoldPayment }> {
  return api.post('/coach-sessions/book', { ...input, payment: 'card' });
}

/** All bookings the caller is involved in — as coach OR as member. */
export function listMyCoachSessionBookings(): Promise<{ bookings: CoachSessionBooking[] }> {
  return api.get('/coach-sessions/me/bookings');
}

// ── Coach actions on a booking ───────────────────────────────────

export function coachConfirmBooking(id: string): Promise<{ booking?: CoachSessionBooking; ok?: boolean }> {
  return api.post(`/coach-sessions/bookings/${id}/coach-confirm`);
}

export function coachDeclineBooking(id: string, reason: string): Promise<{ booking?: CoachSessionBooking; ok?: boolean }> {
  return api.post(`/coach-sessions/bookings/${id}/coach-decline`, { reason });
}

export function coachCompleteBooking(id: string): Promise<{ booking?: CoachSessionBooking; ok?: boolean }> {
  return api.post(`/coach-sessions/bookings/${id}/coach-complete`);
}

// ── Earnings ─────────────────────────────────────────────────────

export interface CoachEarningsRow {
  id:                string;
  member_first_name: string;
  scheduled_at:      string;
  price_aed:         number;
  coach_share_aed:   number;
  state:             string; // upcoming | accrued/earned | settled | …
}

export interface CoachEarnings {
  upcoming_aed: number;
  accrued_aed:  number;
  settled_aed:  number;
  lifetime_aed: number;
  rows:         CoachEarningsRow[];
}

export function getMyCoachEarnings(): Promise<CoachEarnings> {
  return api.get('/coach-sessions/earnings/me');
}
