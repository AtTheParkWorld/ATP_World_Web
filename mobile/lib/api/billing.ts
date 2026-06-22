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
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  plan_id: string;
  plan_name: string;
  plan_tagline: string | null;
  amount_cents: number;
  currency: string;
  interval: string;
  features: string[] | null;
}

export function listPlans(country_code?: string): Promise<{ plans: SubscriptionPlan[]; stripe_configured: boolean }> {
  const q = country_code ? `?country_code=${encodeURIComponent(country_code)}` : '';
  return api.get(`/billing/plans${q}`);
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
