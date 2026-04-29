/**
 * Billing routes — Theme 10 / feedback #36.
 *
 * Public-ish:
 *   GET    /api/billing/plans           — list active plans (no auth needed)
 *
 * Member:
 *   GET    /api/billing/subscription    — current member's subscription state
 *   POST   /api/billing/checkout        — start a Stripe Checkout session
 *   POST   /api/billing/portal          — open the Customer Portal
 *
 * Admin (Theme 5d / #37):
 *   POST   /api/billing/plans
 *   PATCH  /api/billing/plans/:id
 *   DELETE /api/billing/plans/:id
 *
 * Webhook (mounted separately in server.js so it sees the raw body):
 *   webhookHandler  — exported below; receives the verified Stripe event
 *
 * The webhook is wired up in server.js BEFORE express.json() because
 * Stripe's signature verification depends on the unparsed request body.
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const billing = require('../services/billing');
const audit  = require('../services/audit');

// ── GET /api/billing/plans ───────────────────────────────────────
// Public — visible on the upgrade page before signup. Theme 8: an
// optional ?country_id= or ?country_code= filter narrows the result
// to global plans + that country's plans. Without a filter all active
// plans are returned (so an unauthenticated visitor still sees something).
router.get('/plans', async (req, res, next) => {
  try {
    const { country_id, country_code } = req.query;
    const params = [];
    let where = 'WHERE p.is_active = true';
    if (country_id) {
      params.push(country_id);
      where += ` AND (p.country_id IS NULL OR p.country_id = $${params.length})`;
    } else if (country_code) {
      params.push(String(country_code).toUpperCase());
      where += ` AND (p.country_id IS NULL OR p.country_id = (SELECT id FROM countries WHERE code = $${params.length} LIMIT 1))`;
    }
    let rows;
    try {
      const result = await query(
        `SELECT p.id, p.name, p.tagline, p.description, p.currency, p.amount_cents,
                p.interval, p.features, p.sort_order, p.is_active,
                p.country_id,
                CASE WHEN p.stripe_price_id IS NOT NULL THEN true ELSE false END AS purchasable
         FROM subscription_plans p
         ${where}
         ORDER BY p.sort_order, p.amount_cents`,
        params
      );
      rows = result.rows;
    } catch (e) {
      // Fallback for pre-Theme-8 deploys missing the country_id column.
      if (e.code === '42703' /* undefined_column */) {
        const result = await query(
          `SELECT id, name, tagline, description, currency, amount_cents,
                  interval, features, sort_order, is_active,
                  CASE WHEN stripe_price_id IS NOT NULL THEN true ELSE false END AS purchasable
           FROM subscription_plans
           WHERE is_active = true
           ORDER BY sort_order, amount_cents`
        );
        rows = result.rows;
      } else throw e;
    }
    res.json({ plans: rows, stripe_configured: billing.isConfigured() });
  } catch (err) { next(err); }
});

// ── GET /api/billing/subscription ────────────────────────────────
// Member's current subscription (most recent, regardless of status).
router.get('/subscription', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.status, s.current_period_start, s.current_period_end,
              s.cancel_at_period_end, s.cancelled_at,
              p.id  AS plan_id, p.name AS plan_name, p.tagline AS plan_tagline,
              p.amount_cents, p.currency, p.interval, p.features
         FROM subscriptions s
         LEFT JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.member_id = $1
        ORDER BY s.updated_at DESC
        LIMIT 1`,
      [req.member.id]
    );
    res.json({ subscription: rows[0] || null });
  } catch (err) { next(err); }
});

// ── POST /api/billing/checkout ───────────────────────────────────
// Body: { plan_id }  → returns { url } to redirect the browser to.
router.post('/checkout', authenticate, async (req, res, next) => {
  try {
    if (!billing.isConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured yet.' });
    }
    const { plan_id, success_url, cancel_url } = req.body || {};
    if (!plan_id) return res.status(400).json({ error: 'plan_id required' });

    const { rows: plans } = await query(
      `SELECT id, stripe_price_id FROM subscription_plans
        WHERE id=$1 AND is_active=true LIMIT 1`,
      [plan_id]
    );
    if (!plans.length) return res.status(404).json({ error: 'Plan not found.' });

    const { rows: members } = await query(
      'SELECT id, email, first_name, last_name, phone, stripe_customer_id FROM members WHERE id=$1',
      [req.member.id]
    );
    if (!members.length) return res.status(404).json({ error: 'Member not found.' });

    // Default URLs send the user back to /profile with a flag the UI
    // can react to (toast on success, no-op on cancel).
    const origin = req.headers.origin || (process.env.FRONTEND_URL || '');
    const session = await billing.createCheckoutSession({
      member: members[0],
      plan: plans[0],
      successUrl: success_url || (origin + '/profile.html?upgrade=success'),
      cancelUrl:  cancel_url  || (origin + '/profile.html?upgrade=cancel'),
    });
    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ error: err.message });
    next(err);
  }
});

// ── POST /api/billing/portal ─────────────────────────────────────
// Returns a one-time URL into Stripe's hosted Customer Portal.
router.post('/portal', authenticate, async (req, res, next) => {
  try {
    if (!billing.isConfigured()) {
      return res.status(503).json({ error: 'Stripe is not configured yet.' });
    }
    const { return_url } = req.body || {};
    const { rows: members } = await query(
      'SELECT id, email, first_name, last_name, phone, stripe_customer_id FROM members WHERE id=$1',
      [req.member.id]
    );
    if (!members.length) return res.status(404).json({ error: 'Member not found.' });
    if (!members[0].stripe_customer_id) {
      return res.status(400).json({ error: 'No subscription on file yet.' });
    }
    const origin = req.headers.origin || (process.env.FRONTEND_URL || '');
    const portal = await billing.createPortalSession({
      member: members[0],
      returnUrl: return_url || (origin + '/profile.html'),
    });
    res.json({ url: portal.url });
  } catch (err) {
    if (err.status === 503) return res.status(503).json({ error: err.message });
    next(err);
  }
});

// ── ADMIN: subscription plans CRUD (Theme 5d / #37) ──────────────
router.get('/admin/plans', authenticate, requireAdmin, async (req, res, next) => {
  try {
    let rows;
    try {
      const result = await query(
        `SELECT p.id, p.name, p.tagline, p.description, p.stripe_price_id, p.currency,
                p.amount_cents, p.interval, p.features, p.sort_order, p.is_active,
                p.country_id, co.code AS country_code, co.name AS country_name,
                p.created_at, p.updated_at
           FROM subscription_plans p
           LEFT JOIN countries co ON co.id = p.country_id
          ORDER BY p.sort_order, p.created_at ASC`
      );
      rows = result.rows;
    } catch (e) {
      // Pre-Theme-8 fallback (missing country_id / countries table).
      if (e.code === '42703' || e.code === '42P01') {
        const result = await query(
          `SELECT id, name, tagline, description, stripe_price_id, currency,
                  amount_cents, interval, features, sort_order, is_active,
                  created_at, updated_at
             FROM subscription_plans
            ORDER BY sort_order, created_at ASC`
        );
        rows = result.rows;
      } else throw e;
    }
    res.json({ plans: rows });
  } catch (err) { next(err); }
});

router.post('/admin/plans', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const {
      name, tagline, description, stripe_price_id,
      currency, amount_cents, interval, features,
      sort_order, is_active, country_id,
    } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

    const { rows } = await query(
      `INSERT INTO subscription_plans
         (name, tagline, description, stripe_price_id, currency, amount_cents,
          interval, features, sort_order, is_active, country_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [name.trim(), tagline || null, description || null,
       stripe_price_id || null, (currency || 'aed').toLowerCase(),
       Math.max(0, parseInt(amount_cents) || 0),
       (interval === 'year' ? 'year' : 'month'),
       features ? JSON.stringify(features) : null,
       parseInt(sort_order) || 100,
       is_active !== false,
       country_id || null]
    );
    audit.log(req, 'subscription_plan.create', 'subscription_plan', rows[0].id, { name: rows[0].name });
    res.status(201).json({ plan: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/admin/plans/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fields = [];
    const values = [];
    let i = 1;
    const allowed = ['name','tagline','description','stripe_price_id','currency',
                     'amount_cents','interval','features','sort_order','is_active',
                     'country_id'];
    for (const k of allowed) {
      if (k in (req.body || {})) {
        let v = req.body[k];
        if (k === 'features' && v != null) v = JSON.stringify(v);
        if (k === 'currency' && v) v = String(v).toLowerCase();
        if (k === 'interval') v = (v === 'year' ? 'year' : 'month');
        fields.push(`${k}=$${i++}`);
        values.push(v);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE subscription_plans SET ${fields.join(', ')}, updated_at=NOW()
        WHERE id=$${i} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    audit.log(req, 'subscription_plan.update', 'subscription_plan', rows[0].id, { name: rows[0].name });
    res.json({ plan: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/admin/plans/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Soft-delete: deactivating preserves history of past subscriptions
    // pointing at this plan instead of orphaning them.
    const { rows } = await query(
      `UPDATE subscription_plans SET is_active=false, updated_at=NOW()
        WHERE id=$1 RETURNING id, name`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    audit.log(req, 'subscription_plan.deactivate', 'subscription_plan', rows[0].id, { name: rows[0].name });
    res.json({ message: 'Plan deactivated.' });
  } catch (err) { next(err); }
});

// ── WEBHOOK ──────────────────────────────────────────────────────
// Mounted in server.js with express.raw() BEFORE express.json().
// req.body must be the raw Buffer for Stripe.webhooks.constructEvent
// to verify the signature.
async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = billing.constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.warn('[billing] webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Always record the event first (idempotent on event_id) so we have an
  // audit trail even if the handler below throws.
  const isFirstSeen = await billing.recordEvent(event);
  if (!isFirstSeen) {
    // Stripe redelivered a duplicate — already processed.
    return res.json({ received: true, duplicate: true });
  }

  try {
    await billing.handleWebhookEvent(event);
    await query(
      'UPDATE billing_events SET processed_at=NOW(), error=NULL WHERE event_id=$1',
      [event.id]
    );
    res.json({ received: true });
  } catch (err) {
    console.error('[billing] webhook handler error:', err);
    await query(
      'UPDATE billing_events SET error=$2 WHERE event_id=$1',
      [event.id, String(err.message || err).slice(0, 1000)]
    ).catch(() => {});
    // Return 500 so Stripe retries — handler is idempotent so retries
    // won't double-bill anyone.
    res.status(500).json({ error: 'Webhook handler error' });
  }
}

module.exports = router;
module.exports.webhookHandler = webhookHandler;
