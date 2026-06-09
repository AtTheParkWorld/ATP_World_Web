/**
 * Rewards API — points balance, ledger, partner offers, redemption.
 *
 * Points balance lives on the member object, but the dedicated
 * /api/points/balance endpoint also reports an `expiring_soon` count
 * (points scheduled to expire in the next 30 days), which we surface
 * on the Wallet view so the member can spend them before they vanish.
 */
import { api } from './client';

export interface PointsBalance {
  balance: number;
  expiring_soon: number;
}

export interface LedgerEntry {
  id: number;
  amount: number;
  balance: number;
  reason: string;
  description: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Offer {
  id: number;
  title: string;
  slug: string;
  offer_type: 'discount' | 'event' | 'promo' | string;
  description: string | null;
  image_url: string | null;
  terms: string | null;
  discount_pct: number | null;
  points_required: number | null;
  event_date: string | null;
  event_location: string | null;
  event_price_aed: number | null;
  external_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_featured: boolean;
  partner_id: number | null;
  partner_name: string | null;
  partner_logo: string | null;
  partner_website: string | null;
}

export interface Redemption {
  id: number;
  code: string;
  points_spent: number;
  status: 'issued' | 'used' | 'expired' | string;
  issued_at: string;
  used_at: string | null;
  expires_at: string | null;
  offer_id: number;
  title: string;
  offer_type: string;
  image_url: string | null;
  external_url: string | null;
  partner_name: string | null;
  partner_logo: string | null;
}

export function getBalance(): Promise<PointsBalance> {
  return api.get('/points/balance');
}

export function getPointsHistory(page = 1): Promise<{ transactions: LedgerEntry[]; page: number; limit: number }> {
  return api.get(`/members/points-history?page=${page}`);
}

export function listOffers(type?: 'discount' | 'event' | 'promo'): Promise<{ offers: Offer[] }> {
  return api.get(`/offers${type ? `?type=${type}` : ''}`);
}

export function getOffer(id: number): Promise<{ offer: Offer }> {
  return api.get(`/offers/${id}`);
}

export interface RedeemResponse {
  success: boolean;
  already_redeemed?: boolean;
  redemption: Redemption;
  points_balance?: number;
}

export function redeemOffer(id: number): Promise<RedeemResponse> {
  return api.post(`/offers/${id}/redeem`);
}

export function listMyRedemptions(): Promise<{ redemptions: Redemption[] }> {
  return api.get('/offers/my/redemptions');
}

/** Convert points-to-store-discount redemption (Rulebook R-PT-008). */
export interface PointsRedeemResponse {
  discount_code: string;
  aed_value: number;
  new_balance: number;
  redeemed: number;
}
export function redeemPointsForStore(points_to_redeem: number): Promise<PointsRedeemResponse> {
  return api.post('/points/redeem', { points_to_redeem });
}

export interface ReferralRow {
  id: number;
  created_at: string;
  points_awarded: number;
  member_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  subscription_type: string | null;
  last_session_at: string | null;
  sessions_count: number;
  points_from_member: number;
}

export function getReferrals(): Promise<{ referrals: ReferralRow[] }> {
  return api.get('/members/referrals');
}
