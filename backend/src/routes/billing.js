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
                p.annual_amount_cents, p.annual_savings_label,
                COALESCE(p.tier, 'premium') AS tier,
                COALESCE(p.coach_sessions_included, 0) AS coach_sessions_included,
                CASE WHEN p.stripe_price_id        IS NOT NULL THEN true ELSE false END AS purchasable,
                CASE WHEN p.annual_stripe_price_id IS NOT NULL THEN true ELSE false END AS purchasable_annual
         FROM subscription_plans p
         ${where}
         ORDER BY p.sort_order, p.amount_cents`,
        params
      );
      rows = result.rows;
    } catch (e) {
      // Fallback for older deploys missing annual_* columns and/or country_id.
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
    const { plan_id, success_url, cancel_url, interval } = req.body || {};
    if (!plan_id) return res.status(400).json({ error: 'plan_id required' });
    const wantsAnnual = String(interval || '').toLowerCase() === 'year';

    // Resolve the row defensively — annual_* columns may be missing on
    // pre-migration DBs, in which case we just ignore the yearly request
    // and fall back to the monthly Stripe price.
    let planRow = null;
    try {
      const r = await query(
        `SELECT id, stripe_price_id, annual_stripe_price_id, annual_amount_cents
           FROM subscription_plans WHERE id=$1 AND is_active=true LIMIT 1`,
        [plan_id]
      );
      planRow = r.rows[0] || null;
    } catch (e) {
      if (e.code !== '42703') throw e;
      const r = await query(
        `SELECT id, stripe_price_id FROM subscription_plans
          WHERE id=$1 AND is_active=true LIMIT 1`,
        [plan_id]
      );
      planRow = r.rows[0] || null;
    }
    if (!planRow) return res.status(404).json({ error: 'Plan not found.' });

    // Pick yearly Stripe Price when the front-end asked for it and the
    // admin has filled in annual_stripe_price_id on this row. Otherwise
    // fall back to monthly.
    if (wantsAnnual && planRow.annual_stripe_price_id) {
      planRow.stripe_price_id = planRow.annual_stripe_price_id;
    } else if (wantsAnnual && !planRow.annual_stripe_price_id) {
      return res.status(400).json({ error: 'Annual price not configured for this plan yet.' });
    }
    const plans = [planRow];

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
// ── GET /api/billing/admin/webhook-check ─────────────────────────
// Founder-facing diagnostic (2026-08-07). "Are the Stripe webhooks set
// up?" is otherwise unanswerable without opening the Stripe dashboard,
// and a missing event silently breaks coach payouts — the hold is
// placed but we never learn it succeeded. This asks Stripe directly
// which endpoints exist and whether each event we handle is enabled.
//
// REQUIRED_EVENTS must stay in sync with handleWebhookEvent's switch
// in services/billing.js.
const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'payment_intent.canceled',
  'payment_intent.amount_capturable_updated',
];

router.get('/admin/webhook-check', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // A diagnostic must never be answered from cache — the founder
    // clicked "Check now" after fixing Stripe and got a byte-identical
    // stale reply, which read as "the fix didn't work".
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    if (!billing.isConfigured()) {
      return res.json({
        configured: false,
        error: 'Stripe secret key is not set on this server.',
        required_events: REQUIRED_EVENTS,
      });
    }

    const list = await billing.stripe().webhookEndpoints.list({ limit: 20 });

    // Where Stripe SHOULD be sending events: this very server. Found in
    // the wild (2026-08-07): the endpoint still pointed at the retired
    // Railway host, so every event went to a dead server while the
    // event list looked fine. FRONTEND_URL wins (post-cutover domain),
    // else the host serving this request.
    const expectedUrl =
      (process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`)
        .replace(/\/$/, '') + '/api/billing/webhook';
    const sameHost = (u) => {
      try { return new URL(u).host === new URL(expectedUrl).host; }
      catch { return false; }
    };

    // An endpoint subscribed to '*' receives everything.
    const covers = (ep, evt) =>
      (ep.enabled_events || []).includes('*') ||
      (ep.enabled_events || []).includes(evt);

    const endpoints = list.data.map((ep) => ({
      id: ep.id,
      url: ep.url,
      status: ep.status,
      api_version: ep.api_version,
      enabled_events: ep.enabled_events,
      missing_events: REQUIRED_EVENTS.filter((e) => !covers(ep, e)),
      wrong_server: !sameHost(ep.url),
      livemode: ep.livemode,
    }));

    // Green only if ONE enabled endpoint pointing at THIS server covers
    // every event on its own.
    const healthy = endpoints.filter(
      (ep) => ep.status === 'enabled' && !ep.wrong_server && ep.missing_events.length === 0
    );
    const globallyMissing = REQUIRED_EVENTS.filter(
      (e) => !list.data.some((ep) => ep.status === 'enabled' && sameHost(ep.url) && covers(ep, e))
    );

    // Proof events actually ARRIVE here: the webhook handler records
    // every verified event in billing_events. A healthy-looking config
    // with an old last_event is the wrong-URL smoking gun.
    let lastEvent = null;
    try {
      const r = await query(
        `SELECT event_type, processed_at FROM billing_events
          ORDER BY processed_at DESC LIMIT 1`
      );
      lastEvent = r.rows[0] || null;
    } catch (e) { /* table may not exist yet */ }

    // Which Stripe account + mode is this server's key actually talking
    // to? A live-vs-test or wrong-account key explains "I fixed it in the
    // dashboard but the checker disagrees" better than anything else.
    let account = null;
    try {
      const acct = await billing.stripe().accounts.retrieve();
      account = { id: acct.id, name: acct.settings?.dashboard?.display_name || null };
    } catch (e) { /* restricted key may not allow account read */ }

    res.json({
      configured: true,
      ok: healthy.length > 0,
      endpoint_count: endpoints.length,
      expected_url: expectedUrl,
      account,
      key_mode: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test') ? 'test' : 'live',
      checked_at: new Date().toISOString(),
      required_events: REQUIRED_EVENTS,
      missing_events: globallyMissing,
      last_event_received: lastEvent,
      endpoints,
    });
  } catch (err) {
    // Surface Stripe's own message — a restricted key without
    // webhook read permission is the most likely failure.
    res.json({
      configured: true,
      ok: false,
      error: err && err.message ? err.message : 'Stripe request failed',
      required_events: REQUIRED_EVENTS,
      endpoints: [],
    });
  }
});

router.get('/admin/plans', authenticate, requireAdmin, async (req, res, next) => {
  try {
    let rows;
    try {
      const result = await query(
        `SELECT p.id, p.name, p.tagline, p.description, p.stripe_price_id, p.currency,
                p.amount_cents, p.interval, p.features, p.sort_order, p.is_active,
                p.country_id, co.code AS country_code, co.name AS country_name,
                p.annual_amount_cents, p.annual_stripe_price_id, p.annual_savings_label,
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
      annual_amount_cents, annual_stripe_price_id, annual_savings_label,
    } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

    try {
      const { rows } = await query(
        `INSERT INTO subscription_plans
           (name, tagline, description, stripe_price_id, currency, amount_cents,
            interval, features, sort_order, is_active, country_id,
            annual_amount_cents, annual_stripe_price_id, annual_savings_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [name.trim(), tagline || null, description || null,
         stripe_price_id || null, (currency || 'aed').toLowerCase(),
         Math.max(0, parseInt(amount_cents) || 0),
         (interval === 'year' ? 'year' : 'month'),
         features ? JSON.stringify(features) : null,
         parseInt(sort_order) || 100,
         is_active !== false,
         country_id || null,
         annual_amount_cents != null ? Math.max(0, parseInt(annual_amount_cents) || 0) : null,
         annual_stripe_price_id || null,
         annual_savings_label || null]
      );
      audit.log(req, 'subscription_plan.create', 'subscription_plan', rows[0].id, { name: rows[0].name });
      return res.status(201).json({ plan: rows[0] });
    } catch (e) {
      // Pre-migration fallback — annual_* columns missing. Insert without them.
      if (e.code !== '42703') throw e;
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
    }
  } catch (err) { next(err); }
});

router.patch('/admin/plans/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const fields = [];
    const values = [];
    let i = 1;
    const allowed = ['name','tagline','description','stripe_price_id','currency',
                     'amount_cents','interval','features','sort_order','is_active',
                     'country_id',
                     'annual_amount_cents','annual_stripe_price_id','annual_savings_label',
                     // OQ-2 / v1.68 — Premium Plus admin-editable fields.
                     'tier','coach_sessions_included'];
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
    let rows;
    try {
      const r = await query(
        `UPDATE subscription_plans SET ${fields.join(', ')}, updated_at=NOW()
          WHERE id=$${i} RETURNING *`,
        values
      );
      rows = r.rows;
    } catch (e) {
      // Pre-migration: annual_* columns missing. Drop them from the
      // update set and retry so the rest of the patch still goes through.
      if (e.code !== '42703') throw e;
      const annualKeys = new Set(['annual_amount_cents','annual_stripe_price_id','annual_savings_label']);
      const f2 = []; const v2 = []; let j = 1;
      for (const k of allowed) {
        if (annualKeys.has(k)) continue;
        if (k in (req.body || {})) {
          let v = req.body[k];
          if (k === 'features' && v != null) v = JSON.stringify(v);
          if (k === 'currency' && v) v = String(v).toLowerCase();
          if (k === 'interval') v = (v === 'year' ? 'year' : 'month');
          f2.push(`${k}=$${j++}`); v2.push(v);
        }
      }
      if (!f2.length) return res.status(400).json({ error: 'Annual fields not migrated yet — run migrate-annual-plans first.' });
      v2.push(req.params.id);
      const r = await query(
        `UPDATE subscription_plans SET ${f2.join(', ')}, updated_at=NOW()
          WHERE id=$${j} RETURNING *`,
        v2
      );
      rows = r.rows;
    }
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
