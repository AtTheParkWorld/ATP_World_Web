/**
 * Billing API — subscription plans, current subscription, checkout.
 *
 * Mobile uses Stripe's hosted Checkout (web view fallback) rather than
 * the native PaymentSheet for subscriptions, because Apple's policy
 * requires subscriptions either go through StoreKit OR be set up
 * outside the app entirely. Per Apple guideline 3.1.3, fitness-club
 * memberships ARE exempt and can use external payment, but the safest
 * App Store approach for ATP today is to launch the Stripe hosted
 * Checkout in an in-app browser, then return to the app.
 */
import { api } from './client';

export interface SubscriptionPlan {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  currency: string;
  amount_cents: number;
  interval: 'month' | 'year';
  features: string[] | null;
  sort_order: number;
  tier: 'free' | 'premium' | 'premium_plus';
  coach_sessions_included: number;
  annual_amount_cents: number | null;
  annual_savings_label: string | null;
  purchasable: boolean;
  purchasable_annual: boolean;
}

export interface CurrentSubscription {
  id: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | string;
  /** Nullable in the DB — webhook fills them in after checkout, so an
   *  'incomplete' sub can have neither period stamp yet. */
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  /** Plan columns come from a LEFT JOIN (plan_id is ON DELETE SET NULL),
   *  so all of them can be null if the plan row was deleted. */
  plan_id: string | null;
  plan_name: string | null;
  plan_tagline: string | null;
  amount_cents: number | null;
  currency: string | null;
  interval: string | null;
  features: string[] | null;
}

/** /billing/plans has an older-deploy fallback (undefined_column) that
 *  omits tier/coach_sessions/annual columns — so they're optional on
 *  the wire even though the primary SELECT always sends them. */
type SubscriptionPlanWire =
  Omit<SubscriptionPlan, 'tier' | 'coach_sessions_included' | 'annual_amount_cents' | 'annual_savings_label' | 'purchasable_annual'>
  & Partial<Pick<SubscriptionPlan, 'tier' | 'coach_sessions_included' | 'annual_amount_cents' | 'annual_savings_label' | 'purchasable_annual'>>;

export async function listPlans(country_code?: string): Promise<{ plans: SubscriptionPlan[]; stripe_configured: boolean }> {
  const q = country_code ? `?country_code=${encodeURIComponent(country_code)}` : '';
  const r = await api.get<{ plans?: SubscriptionPlanWire[]; stripe_configured?: boolean }>(`/billing/plans${q}`);
  // Fill the fallback-branch gaps with the same defaults the primary
  // SELECT's COALESCEs use, so screens can trust the declared type.
  const plans: SubscriptionPlan[] = (r.plans || []).map((p) => ({
    ...p,
    amount_cents:            Number(p.amount_cents) || 0,
    tier:                    p.tier ?? 'premium',
    coach_sessions_included: Number(p.coach_sessions_included) || 0,
    annual_amount_cents:     p.annual_amount_cents ?? null,
    annual_savings_label:    p.annual_savings_label ?? null,
    purchasable:             !!p.purchasable,
    purchasable_annual:      !!p.purchasable_annual,
  }));
  return { plans, stripe_configured: !!r.stripe_configured };
}

export function getMySubscription(): Promise<{ subscription: CurrentSubscription | null }> {
  return api.get('/billing/subscription');
}

export interface CheckoutResponse {
  url: string;       // Stripe hosted Checkout — open in WebBrowser
}

export function createCheckout(plan_id: string, interval: 'month' | 'year' = 'month'):
  Promise<CheckoutResponse> {
  return api.post('/billing/checkout', {
    plan_id,
    interval,
    success_url: 'atp://billing/success',
    cancel_url:  'atp://billing/cancel',
  });
}

export function openPortal(): Promise<CheckoutResponse> {
  // Stripe customer portal — manage / cancel
  return api.post('/billing/portal', {
    return_url: 'atp://billing/return',
  });
}
