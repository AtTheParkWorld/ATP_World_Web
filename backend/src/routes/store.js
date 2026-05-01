/**
 * /api/store — tier-1 commerce features layered on top of the
 * existing Shopify Storefront integration.
 *
 *   GET    /wishlist                — list current member's wishlist
 *   POST   /wishlist                — add item (upsert)
 *   DELETE /wishlist/:product_id    — remove item
 *
 *   GET    /cart                    — load synced cart for current member
 *   PUT    /cart                    — overwrite synced cart
 *
 *   GET    /reviews/:product_id     — public aggregate + recent reviews
 *   POST   /reviews/:product_id     — member posts/updates own review
 *   DELETE /reviews/:product_id     — member deletes own review
 *
 *   POST   /points/quote            — preview redemption (no DB write)
 *   POST   /points/redeem           — atomically deduct points + issue
 *                                     a discount code; returns the code
 *
 * Shopify itself remains the source of truth for products, inventory,
 * checkout. We only persist what's member-scoped (wishlists / carts)
 * or community-generated (reviews) on our side.
 */
const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate } = require('../middleware/auth');

// ── helpers ──────────────────────────────────────────────────────
function _missingTable(e) { return e && (e.code === '42P01' || e.code === '42703'); }

// ════════════════════════════════════════════════════════════════
// WISHLIST
// ════════════════════════════════════════════════════════════════

// GET /api/store/wishlist
router.get('/wishlist', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT product_id, product_handle, product_title, product_image_url,
              product_price, product_currency, added_at
         FROM wishlists
        WHERE member_id = $1
        ORDER BY added_at DESC`,
      [req.member.id]
    ).catch((e) => { if (_missingTable(e)) return { rows: [] }; throw e; });
    res.json({ wishlist: rows });
  } catch (err) { next(err); }
});

// POST /api/store/wishlist
// body: { product_id, product_handle?, product_title?, product_image_url?, product_price?, product_currency? }
router.post('/wishlist', authenticate, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.product_id) return res.status(400).json({ error: 'product_id required' });
    await query(
      `INSERT INTO wishlists (member_id, product_id, product_handle, product_title,
                              product_image_url, product_price, product_currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (member_id, product_id) DO UPDATE SET
         product_handle = EXCLUDED.product_handle,
         product_title  = EXCLUDED.product_title,
         product_image_url = EXCLUDED.product_image_url,
         product_price  = EXCLUDED.product_price,
         product_currency = EXCLUDED.product_currency`,
      [req.member.id, b.product_id, b.product_handle || null, b.product_title || null,
       b.product_image_url || null,
       b.product_price != null ? Number(b.product_price) : null,
       b.product_currency || null]
    );
    res.json({ message: 'Added to wishlist.' });
  } catch (err) { next(err); }
});

// DELETE /api/store/wishlist/:product_id
// product_id may contain slashes (Shopify gids), so accept query param too.
router.delete('/wishlist/:product_id(*)', authenticate, async (req, res, next) => {
  try {
    const pid = req.params.product_id || req.query.product_id;
    if (!pid) return res.status(400).json({ error: 'product_id required' });
    await query(`DELETE FROM wishlists WHERE member_id=$1 AND product_id=$2`, [req.member.id, pid]);
    res.json({ message: 'Removed from wishlist.' });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// SERVER-SYNCED CART
// ════════════════════════════════════════════════════════════════

// GET /api/store/cart
router.get('/cart', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT cart_data, updated_at FROM member_carts WHERE member_id=$1`,
      [req.member.id]
    ).catch((e) => { if (_missingTable(e)) return { rows: [] }; throw e; });
    res.json({
      cart: rows[0] && rows[0].cart_data || [],
      updated_at: rows[0] && rows[0].updated_at || null,
    });
  } catch (err) { next(err); }
});

// PUT /api/store/cart
// body: { cart: [...] }
router.put('/cart', authenticate, async (req, res, next) => {
  try {
    const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];
    // Hard cap: don't let a runaway frontend dump megabytes of cart
    // state — Postgres rows shouldn't exceed a few KB for this.
    if (JSON.stringify(cart).length > 32 * 1024) {
      return res.status(413).json({ error: 'Cart too large.' });
    }
    await query(
      `INSERT INTO member_carts (member_id, cart_data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (member_id) DO UPDATE
         SET cart_data = EXCLUDED.cart_data,
             updated_at = NOW()`,
      [req.member.id, JSON.stringify(cart)]
    );
    res.json({ message: 'Cart synced.', items: cart.length });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// PRODUCT REVIEWS
// ════════════════════════════════════════════════════════════════

// GET /api/store/reviews/:product_id (public)
router.get('/reviews/:product_id(*)', async (req, res, next) => {
  try {
    const pid = req.params.product_id;
    if (!pid) return res.status(400).json({ error: 'product_id required' });
    const [agg, recent] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                ROUND(AVG(rating)::numeric, 1)::float AS average,
                COUNT(*) FILTER (WHERE rating=5)::int AS r5,
                COUNT(*) FILTER (WHERE rating=4)::int AS r4,
                COUNT(*) FILTER (WHERE rating=3)::int AS r3,
                COUNT(*) FILTER (WHERE rating=2)::int AS r2,
                COUNT(*) FILTER (WHERE rating=1)::int AS r1
           FROM product_reviews
          WHERE product_id = $1 AND is_published = true`,
        [pid]
      ).catch((e) => { if (_missingTable(e)) return { rows: [{ total: 0, average: null }] }; throw e; }),
      query(
        `SELECT r.id, r.rating, r.title, r.body, r.verified_purchase, r.created_at,
                m.first_name, m.last_name
           FROM product_reviews r
           JOIN members m ON m.id = r.member_id
          WHERE r.product_id = $1 AND r.is_published = true
          ORDER BY r.created_at DESC
          LIMIT 20`,
        [pid]
      ).catch((e) => { if (_missingTable(e)) return { rows: [] }; throw e; }),
    ]);
    // Strip last names to first-initial for privacy.
    const reviews = recent.rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body:  r.body,
      verified_purchase: r.verified_purchase,
      created_at: r.created_at,
      reviewer: ((r.first_name || '') + ' ' + ((r.last_name || '')[0] || '')).trim() + '.',
    }));
    res.json({
      product_id: pid,
      summary: agg.rows[0],
      reviews,
    });
  } catch (err) { next(err); }
});

// POST /api/store/reviews/:product_id (member)
router.post('/reviews/:product_id(*)', authenticate, async (req, res, next) => {
  try {
    const pid = req.params.product_id;
    if (!pid) return res.status(400).json({ error: 'product_id required' });
    const rating = Math.max(1, Math.min(5, parseInt(req.body?.rating, 10) || 0));
    if (!rating) return res.status(400).json({ error: 'rating must be 1–5' });
    const title = String(req.body?.title || '').trim().slice(0, 120) || null;
    const body  = String(req.body?.body  || '').trim().slice(0, 2000) || null;

    const { rows } = await query(
      `INSERT INTO product_reviews (member_id, product_id, rating, title, body)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (member_id, product_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             title  = EXCLUDED.title,
             body   = EXCLUDED.body,
             updated_at = NOW()
       RETURNING id, rating, title, body, verified_purchase, created_at`,
      [req.member.id, pid, rating, title, body]
    );
    res.status(201).json({ review: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/store/reviews/:product_id (member's own only)
router.delete('/reviews/:product_id(*)', authenticate, async (req, res, next) => {
  try {
    const pid = req.params.product_id;
    if (!pid) return res.status(400).json({ error: 'product_id required' });
    await query(`DELETE FROM product_reviews WHERE member_id=$1 AND product_id=$2`,
      [req.member.id, pid]);
    res.json({ message: 'Review removed.' });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// POINTS REDEMPTION
// ════════════════════════════════════════════════════════════════

// Read the points-per-currency-unit from system_config (Theme 4) so
// the rate stays admin-tunable. Falls back to 28 = "28 pts per AED".
async function _getRate() {
  try {
    const { rows } = await query(`SELECT value FROM system_config WHERE key='store_credit_atp_per_unit'`);
    if (rows[0]) {
      const v = rows[0].value;
      const n = typeof v === 'number' ? v : Number(typeof v === 'string' ? v.replace(/^"|"$/g, '') : v);
      if (n > 0) return n;
    }
  } catch (e) { /* table may not exist on a fresh install */ }
  return 28;
}

// POST /api/store/points/quote
// body: { points }
// Returns the equivalent currency value at the current rate. No
// state changes — pure preview for the cart UI.
router.post('/points/quote', authenticate, async (req, res, next) => {
  try {
    const points = Math.max(0, parseInt(req.body?.points, 10) || 0);
    const rate = await _getRate();
    const value = rate > 0 ? Math.floor(points / rate) : 0;
    res.json({
      points,
      rate_atp_per_unit: rate,
      amount_value: value,
      currency_code: 'AED',
      member_balance: req.member.points_balance || 0,
    });
  } catch (err) { next(err); }
});

// POST /api/store/points/redeem
// body: { points }
// Atomically deducts points + creates a points_redemptions record +
// returns a discount code the member can paste into Shopify checkout.
//
// NOTE on the discount code: in production the right move is to call
// Shopify Admin API → discountCodeBasicCreate so the code is real and
// limited to that member. For now we:
//   - Generate a unique pseudo-random code (ATP-PTS-XXXXXX)
//   - Persist amount_value + status='issued' so admin can later
//     reconcile if Shopify integration is added
//   - Tell the member "Use this code at checkout" in the UI
//
// If/when Shopify Admin API is wired up, swap the code generation
// with the real createDiscountCode call here. The frontend won't need
// changes.
router.post('/points/redeem', authenticate, async (req, res, next) => {
  try {
    const points = Math.max(0, parseInt(req.body?.points, 10) || 0);
    if (points <= 0) return res.status(400).json({ error: 'points must be positive' });

    const rate = await _getRate();
    const value = rate > 0 ? Math.floor(points / rate) : 0;
    if (value <= 0) return res.status(400).json({ error: 'points are below the minimum redeemable amount.' });

    const result = await transaction(async (client) => {
      const { rows: m } = await client.query(
        'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
        [req.member.id]
      );
      const balance = (m[0] && m[0].points_balance) || 0;
      if (balance < points) {
        const e = new Error('Not enough points — you have ' + balance + ', tried to redeem ' + points + '.');
        e.status = 400;
        throw e;
      }
      const newBalance = balance - points;
      await client.query(
        'UPDATE members SET points_balance=$1 WHERE id=$2',
        [newBalance, req.member.id]
      );
      await client.query(
        `INSERT INTO points_ledger (member_id, amount, balance, reason, description)
         VALUES ($1, $2, $3, 'store_redemption', $4)`,
        [req.member.id, -points, newBalance, 'Redeemed ' + points + ' pts for AED ' + value + ' store discount']
      );
      // Generate a code. Crockford-base32-ish (no I, O, 0, 1) for clarity.
      const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let suffix = '';
      for (let i = 0; i < 6; i++) suffix += alpha[Math.floor(Math.random() * alpha.length)];
      const code = 'ATP-PTS-' + suffix;
      const expiresAt = new Date(Date.now() + 30 * 86400000); // 30 days
      const { rows: red } = await client.query(
        `INSERT INTO points_redemptions
           (member_id, points_spent, discount_code, amount_value, currency_code, expires_at)
         VALUES ($1,$2,$3,$4,'AED',$5)
         RETURNING id, discount_code, amount_value, currency_code, expires_at, issued_at`,
        [req.member.id, points, code, value, expiresAt]
      );
      return { redemption: red[0], new_balance: newBalance };
    });

    // ─ Shopify Admin: create the actual discount code ────────────
    // Done AFTER the DB transaction so a Shopify outage doesn't block
    // the points debit. If Shopify rejects the code we mark the row
    // status='shopify_failed' so admin can retry from the maintenance
    // tab; the member sees a polite "we'll email you" instead of a
    // half-broken code.
    const shopify = require('../services/shopify');
    let shopifyDiscountId = null;
    let shopifyOk = false;
    let shopifyError = null;
    if (shopify.isConfigured()) {
      try {
        const created = await shopify.createDiscountCode({
          code:      result.redemption.discount_code,
          amount:    Number(result.redemption.amount_value),
          currency:  'AED',
          expiresAt: result.redemption.expires_at,
          title:     'ATP points (' + points + ' pts → AED ' + value + ')',
        });
        shopifyDiscountId = created.id;
        shopifyOk = true;
        await query(
          `UPDATE points_redemptions
              SET shopify_discount_id = $1,
                  shopify_error       = NULL
            WHERE id = $2`,
          [shopifyDiscountId, result.redemption.id]
        );
      } catch (e) {
        shopifyError = e.message || String(e);
        console.warn('[store] Shopify discount create failed:', shopifyError);
        await query(
          `UPDATE points_redemptions
              SET status        = 'shopify_failed',
                  shopify_error = $1
            WHERE id = $2`,
          [shopifyError.slice(0, 500), result.redemption.id]
        ).catch(() => {});
      }
    } else {
      // No Admin API configured → DB-only legacy mode. Document this
      // in the response so the UI can warn the member that an admin
      // will reach out.
      shopifyError = 'shopify-admin-not-configured';
    }

    res.status(201).json({
      message: shopifyOk
        ? ('AED ' + result.redemption.amount_value + ' discount unlocked.')
        : ('AED ' + result.redemption.amount_value + ' redeemed — your code will be sent shortly.'),
      discount_code: result.redemption.discount_code,
      amount_value:  Number(result.redemption.amount_value),
      currency_code: 'AED',
      points_spent:  points,
      points_balance: result.new_balance,
      expires_at: result.redemption.expires_at,
      shopify_active: shopifyOk,
      shopify_discount_id: shopifyDiscountId,
      next_step: shopifyOk
        ? 'Paste this code at Shopify checkout. It expires in 30 days.'
        : 'Your points are reserved. We\u2019ll activate the code at Shopify and email it to you within an hour.',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/store/admin/points/:id/retry-shopify (admin)
// For redemptions that were issued in the DB but failed to create the
// Shopify code (e.g. Admin token wasn't set yet, transient network
// error). Re-runs the Shopify create + flips status back to 'issued'.
router.post('/admin/points/:id/retry-shopify', authenticate, async (req, res, next) => {
  try {
    if (!req.member.is_admin) return res.status(403).json({ error: 'Admin only' });
    const { rows } = await query(
      `SELECT * FROM points_redemptions WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Redemption not found' });
    const r = rows[0];
    if (r.shopify_discount_id) {
      return res.json({ message: 'Already mirrored to Shopify.', shopify_discount_id: r.shopify_discount_id });
    }
    const shopify = require('../services/shopify');
    if (!shopify.isConfigured()) {
      return res.status(503).json({ error: 'Shopify Admin API not configured (set SHOPIFY_ADMIN_TOKEN).' });
    }
    try {
      const created = await shopify.createDiscountCode({
        code:      r.discount_code,
        amount:    Number(r.amount_value),
        currency:  r.currency_code || 'AED',
        expiresAt: r.expires_at,
        title:     'ATP points retry (' + r.points_spent + ' pts → ' + (r.currency_code || 'AED') + ' ' + r.amount_value + ')',
      });
      await query(
        `UPDATE points_redemptions
            SET shopify_discount_id = $1,
                shopify_error       = NULL,
                status              = 'issued'
          WHERE id = $2`,
        [created.id, r.id]
      );
      res.json({ message: 'Discount mirrored to Shopify.', shopify_discount_id: created.id });
    } catch (e) {
      await query(
        `UPDATE points_redemptions SET shopify_error = $1 WHERE id = $2`,
        [(e.message || String(e)).slice(0, 500), r.id]
      ).catch(() => {});
      res.status(502).json({ error: e.message, code: e.code || 'SHOPIFY_RETRY_FAILED' });
    }
  } catch (err) { next(err); }
});

// GET /api/store/admin/points/failed (admin)
// Lists redemptions stuck in shopify_failed so admin can see what's
// pending mirror.
router.get('/admin/points/failed', authenticate, async (req, res, next) => {
  try {
    if (!req.member.is_admin) return res.status(403).json({ error: 'Admin only' });
    const { rows } = await query(
      `SELECT r.*, m.first_name, m.last_name, m.email
         FROM points_redemptions r
         JOIN members m ON m.id = r.member_id
        WHERE r.status = 'shopify_failed' OR (r.shopify_discount_id IS NULL AND r.shopify_error IS NOT NULL)
        ORDER BY r.issued_at DESC
        LIMIT 100`
    ).catch((e) => { if (_missingTable(e)) return { rows: [] }; throw e; });
    res.json({ failed: rows });
  } catch (err) { next(err); }
});

// GET /api/store/points/redemptions — recent codes a member has issued
router.get('/points/redemptions', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, points_spent, discount_code, amount_value, currency_code,
              status, issued_at, used_at, expires_at
         FROM points_redemptions
        WHERE member_id = $1
        ORDER BY issued_at DESC
        LIMIT 20`,
      [req.member.id]
    ).catch((e) => { if (_missingTable(e)) return { rows: [] }; throw e; });
    res.json({ redemptions: rows });
  } catch (err) { next(err); }
});

module.exports = router;
