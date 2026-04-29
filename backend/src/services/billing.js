/**
 * Billing service — Theme 10 / feedback #36.
 *
 * Wraps the Stripe SDK (lazy-initialised so the rest of the app boots
 * even if STRIPE_SECRET_KEY isn't set yet) and centralises all subscription
 * state mutations. The webhook handler in routes/billing.js calls into
 * here for every event so we have a single place to keep the database in
 * sync with Stripe.
 *
 * Design choices
 * --------------
 * - Stripe is the source of truth for billing state. We mirror it locally
 *   so the rest of the app (members.subscription_type, profile UI, etc.)
 *   doesn't have to make a Stripe API call on every request.
 * - members.subscription_type is set to 'premium' when the subscription is
 *   in any "active-ish" state (active, trialing, past_due) and reverts to
 *   'free' on cancel/unpaid. This mirrors the existing string already used
 *   across the app (referrals service, etc.) so nothing else has to change.
 * - Every webhook event is recorded in billing_events for replay/debug.
 *   The unique event_id constraint handles Stripe's at-least-once delivery
 *   without us having to write idempotency keys ourselves.
 */
const { query, transaction } = require('../db');

let _stripe = null;
function stripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const e = new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.');
    e.status = 503;
    throw e;
  }
  // Lazy require so missing dep doesn't crash the rest of the app at boot.
  const Stripe = require('stripe');
  _stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  return _stripe;
}

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// "Active-ish" Stripe subscription statuses that we treat as premium.
// past_due is deliberately included so a single failed charge doesn't
// instantly demote the member — Stripe will retry and either land on
// active or unpaid (which we treat as cancelled).
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ── Customer helpers ─────────────────────────────────────────────
// Get-or-create a Stripe Customer for a member. Stores the id locally
// so subsequent calls are a no-op DB lookup.
async function ensureCustomer(member) {
  if (member.stripe_customer_id) return member.stripe_customer_id;

  const customer = await stripe().customers.create({
    email: member.email,
    name:  [member.first_name, member.last_name].filter(Boolean).join(' ') || undefined,
    phone: member.phone || undefined,
    metadata: { member_id: member.id },
  });

  await query(
    'UPDATE members SET stripe_customer_id=$1, updated_at=NOW() WHERE id=$2',
    [customer.id, member.id]
  );
  return customer.id;
}

// ── Checkout ─────────────────────────────────────────────────────
// Creates a Stripe Checkout Session for the given price. Returns the
// hosted-checkout URL. Frontend redirects the browser to this URL.
async function createCheckoutSession({ member, plan, successUrl, cancelUrl }) {
  if (!plan || !plan.stripe_price_id) {
    const e = new Error('This plan is not connected to a Stripe price yet.');
    e.status = 400;
    throw e;
  }
  const customerId = await ensureCustomer(member);
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // client_reference_id lets us link the session back to a member if
    // a webhook ever fires before we've persisted the subscription row.
    client_reference_id: member.id,
    metadata: {
      member_id: member.id,
      plan_id:   plan.id,
    },
    allow_promotion_codes: true,
    // Default Stripe behavior is fine — we don't need any payment_intent
    // tweaks for a vanilla recurring subscription.
  });
  return session;
}

// ── Customer Portal ──────────────────────────────────────────────
// Returns a one-time URL to Stripe's hosted Customer Portal where the
// member can update payment method, view invoices, and cancel.
async function createPortalSession({ member, returnUrl }) {
  const customerId = await ensureCustomer(member);
  const portal = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return portal;
}

// ── Webhook event processing ─────────────────────────────────────
// Convert a Stripe subscription object into our local row + flip the
// member's subscription_type to match. Idempotent — safe to call
// multiple times for the same subscription.
async function syncSubscription(stripeSub) {
  if (!stripeSub || !stripeSub.id) return;

  // Find our local plan by the price id Stripe used.
  const priceId = stripeSub.items?.data?.[0]?.price?.id || null;
  let planId = null;
  if (priceId) {
    const { rows: planRows } = await query(
      'SELECT id FROM subscription_plans WHERE stripe_price_id=$1 LIMIT 1',
      [priceId]
    );
    planId = planRows[0]?.id || null;
  }

  // Find member by stripe_customer_id (always present on a real sub).
  const { rows: memberRows } = await query(
    'SELECT id FROM members WHERE stripe_customer_id=$1 LIMIT 1',
    [stripeSub.customer]
  );
  const memberId = memberRows[0]?.id;
  if (!memberId) {
    console.warn('[billing] received subscription event for unknown customer', stripeSub.customer);
    return;
  }

  const periodStart = stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : null;
  const periodEnd   = stripeSub.current_period_end   ? new Date(stripeSub.current_period_end   * 1000) : null;
  const cancelledAt = stripeSub.canceled_at          ? new Date(stripeSub.canceled_at          * 1000) : null;

  await transaction(async (client) => {
    // Upsert the local subscription row (one per Stripe subscription id).
    await client.query(
      `INSERT INTO subscriptions (
         member_id, plan_id,
         stripe_subscription_id, stripe_customer_id, stripe_price_id,
         status, current_period_start, current_period_end,
         cancel_at_period_end, cancelled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET
         plan_id=EXCLUDED.plan_id,
         stripe_price_id=EXCLUDED.stripe_price_id,
         status=EXCLUDED.status,
         current_period_start=EXCLUDED.current_period_start,
         current_period_end=EXCLUDED.current_period_end,
         cancel_at_period_end=EXCLUDED.cancel_at_period_end,
         cancelled_at=EXCLUDED.cancelled_at,
         updated_at=NOW()`,
      [memberId, planId,
       stripeSub.id, stripeSub.customer, priceId,
       stripeSub.status, periodStart, periodEnd,
       stripeSub.cancel_at_period_end || false, cancelledAt]
    );

    // Decide the member's subscription_type. If they have ANY active sub
    // they're premium; if all are cancelled/unpaid they're free. We check
    // across all their subs (not just this one) so toggling between plans
    // doesn't briefly demote them.
    const { rows: anyActive } = await client.query(
      `SELECT 1 FROM subscriptions
        WHERE member_id=$1 AND status = ANY($2::text[])
        LIMIT 1`,
      [memberId, Array.from(ACTIVE_STATUSES)]
    );
    const isPremium = anyActive.length > 0;

    await client.query(
      `UPDATE members
          SET subscription_type=$1,
              subscription_status=$2,
              subscription_renews_at=$3,
              updated_at=NOW()
        WHERE id=$4`,
      [isPremium ? 'premium' : 'free',
       stripeSub.status,
       isPremium ? periodEnd : null,
       memberId]
    );
  });
}

// Record every webhook event for audit/debug, with idempotency on event_id.
// Returns true if this is the first time we've seen this event id.
async function recordEvent(event) {
  try {
    const { rowCount } = await query(
      `INSERT INTO billing_events (event_id, event_type, object_id, payload, processed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.type, event.data?.object?.id || null, JSON.stringify(event)]
    );
    return rowCount > 0;
  } catch (e) {
    console.warn('[billing] recordEvent failed', e.message);
    return true; // don't block processing on audit failure
  }
}

// Top-level webhook event router. Pulls the full subscription object
// from Stripe (so we always have current state, not just the diff that
// triggered the event) and pushes it through syncSubscription.
async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        const sub = await stripe().subscriptions.retrieve(session.subscription);
        await syncSubscription(sub);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.trial_will_end': {
      // event.data.object IS the subscription, no extra fetch needed.
      await syncSubscription(event.data.object);
      break;
    }
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      // Pull the parent subscription so the local status is fresh
      // (status flips to past_due/paid based on the invoice outcome).
      const inv = event.data.object;
      if (inv.subscription) {
        const sub = await stripe().subscriptions.retrieve(inv.subscription);
        await syncSubscription(sub);
      }
      break;
    }
    default:
      // Many event types we don't care about — recording was enough.
      break;
  }
}

function constructWebhookEvent(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const e = new Error('STRIPE_WEBHOOK_SECRET not configured.');
    e.status = 503;
    throw e;
  }
  return stripe().webhooks.constructEvent(rawBody, signatureHeader, secret);
}

module.exports = {
  isConfigured,
  ensureCustomer,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  handleWebhookEvent,
  recordEvent,
  syncSubscription,
};
