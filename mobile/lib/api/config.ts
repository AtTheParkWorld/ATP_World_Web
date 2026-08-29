/**
 * Live platform config (founder 2026-09-16). The numbers members read
 * in copy — referral bonus, streak milestone, points-per-dirham — are
 * owned by Admin → System Config. The app reads them from
 * GET /config/public so changing a value in the admin panel changes
 * the sentence in the app without a new release.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface PublicConfig {
  referral_signup_points: number;
  tribe_checkin_points_free: number;
  tribe_checkin_points_premium: number;
  premium_renewal_referrer_points: number;
  streak_double_threshold: number;
  store_credit_atp_per_unit: number;
  store_credit_currency: string;
  welcome_discount_percentage: number;
  welcome_discount_expiry_days: number;
  profile_complete_points: number;
}

/** Same defaults the API serves, so copy renders instantly and never blank. */
export const CONFIG_DEFAULTS: PublicConfig = {
  referral_signup_points: 50,
  tribe_checkin_points_free: 1,
  tribe_checkin_points_premium: 2,
  premium_renewal_referrer_points: 200,
  streak_double_threshold: 5,
  store_credit_atp_per_unit: 28,
  store_credit_currency: 'AED',
  welcome_discount_percentage: 20,
  welcome_discount_expiry_days: 60,
  profile_complete_points: 200,
};

export function getPublicConfig(): Promise<{ config: PublicConfig }> {
  return api.get('/config/public');
}

/**
 * Never suspends and never returns undefined — falls back to the
 * defaults so a screen can write `cfg.streak_double_threshold`
 * unconditionally.
 */
export function useConfig(): PublicConfig {
  const q = useQuery({
    queryKey: ['public-config'],
    queryFn: () => getPublicConfig().then((r) => r.config),
    staleTime: 1000 * 60 * 10,
  });
  return { ...CONFIG_DEFAULTS, ...(q.data || {}) };
}
