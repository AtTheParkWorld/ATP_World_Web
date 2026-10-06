/**
 * Member order history — the signed-in member's Shopify orders, shaped
 * for the app's "My orders" screen and the website profile.
 *
 * Founder items 7 + 8 (2026-10-06): "Members should be able to track
 * their online orders" / "track all their past apparel buys on their
 * profile".
 *
 * Matching rule (the whole point of this file):
 *   - ATP members and Shopify customers are NOT linked by id. The only
 *     shared key is the email address, so an order belongs to a member
 *     when order.email equals the member's email — exact, case-
 *     insensitive, re-checked here on every row Shopify returns.
 *   - The member's email must be VERIFIED. /auth/register hands out a
 *     session before any proof of inbox ownership, so an unverified
 *     address could be someone else's — and their orders with it.
 *   - No email / unverified / Shopify not set up → empty list. Never a
 *     fallback that could widen the match.
 *
 * Results are cached per member+email for a minute: the list is read on
 * every Profile visit and Shopify's Admin API is rate-limited per shop.
 * `fresh` bypasses the cache (thank-you screen right after checkout).
 */
const { query } = require('../db');
const shopify = require('./shopify');

const CACHE_TTL_MS = 60 * 1000;
const FRESH_FLOOR_MS = 5 * 1000;
const CACHE_MAX = 500;
const _cache = new Map();   // `${memberId}|${email}` → { at, value }

const STATUS_LABEL = {
  processing:      'Preparing',
  pending_payment: 'Awaiting payment',
  shipped:         'On its way',
  delivered:       'Delivered',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
};

function _shopUrl() {
  return 'https://' + (process.env.SHOPIFY_DOMAIN || 'atp-store-7903.myshopify.com');
}

function _money(set) {
  const m = set && (set.presentmentMoney || set.shopMoney);
  if (!m) return null;
  return { amount: Number(m.amount) || 0, currency: m.currencyCode || null };
}

/** One bucket per order, so app + web show the same chip. */
function deriveStatus(o) {
  if (o.cancelledAt || o.displayFinancialStatus === 'VOIDED') return 'cancelled';
  if (o.displayFinancialStatus === 'REFUNDED') return 'refunded';
  const live = (o.fulfillments || []).filter((f) => f.status !== 'CANCELLED' && f.displayStatus !== 'CANCELED');
  if (live.length && live.every((f) => f.deliveredAt || f.displayStatus === 'DELIVERED' || f.displayStatus === 'PICKED_UP')) {
    return 'delivered';
  }
  if (live.length || o.displayFulfillmentStatus === 'FULFILLED' || o.displayFulfillmentStatus === 'PARTIALLY_FULFILLED') {
    return 'shipped';
  }
  if (o.displayFinancialStatus === 'PENDING') return 'pending_payment';
  return 'processing';
}

function toOrderDto(o) {
  const total = _money(o.totalPriceSet);
  const fulfillments = (o.fulfillments || [])
    .filter((f) => f.status !== 'CANCELLED')
    .map((f) => ({
      status:                f.displayStatus || f.status || null,
      shipped_at:            f.inTransitAt || f.createdAt || null,
      delivered_at:          f.deliveredAt || null,
      estimated_delivery_at: f.estimatedDeliveryAt || null,
      tracking: (f.trackingInfo || []).map((t) => ({
        number:  t.number || null,
        company: t.company || null,
        url:     t.url || null,
      })),
    }));
  const tracking = fulfillments.reduce((all, f) => all.concat(f.tracking), []);
  const firstTrackUrl = (tracking.find((t) => t.url) || {}).url || null;
  const status = deriveStatus(o);
  return {
    id:           o.id,
    number:       o.name,
    created_at:   o.processedAt || o.createdAt,
    cancelled_at: o.cancelledAt || null,
    status,
    status_label: STATUS_LABEL[status],
    financial_status:   o.displayFinancialStatus || null,
    fulfillment_status: o.displayFulfillmentStatus || null,
    currency: (total && total.currency) || null,
    subtotal: (_money(o.subtotalPriceSet) || {}).amount ?? null,
    shipping: (_money(o.totalShippingPriceSet) || {}).amount ?? null,
    total:    total ? total.amount : null,
    items: ((o.lineItems && o.lineItems.nodes) || []).map((li) => ({
      title:     li.title,
      variant:   li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null,
      quantity:  li.quantity,
      image_url: (li.image && li.image.url) || null,
      total:     (_money(li.discountedTotalSet) || {}).amount ?? null,
    })),
    fulfillments,
    tracking,
    // Carrier page when there is one, else Shopify's own order-status
    // page (it shows the timeline even before anything ships).
    track_url:        firstTrackUrl || o.statusPageUrl || null,
    order_status_url: o.statusPageUrl || null,
  };
}

function _result(orders, reason) {
  return {
    orders,
    reason: reason || null,
    // Shopify's own customer-account page — the fallback when our list
    // can't load (it asks the buyer for a one-time email code).
    account_orders_url: _shopUrl() + '/account',
  };
}

/**
 * @param {string} memberId
 * @param {{ fresh?: boolean }} [opts]
 * @returns {Promise<{ orders: object[], reason: string|null, account_orders_url: string }>}
 *   reason: null | 'no_email' | 'email_unverified' | 'not_configured' | 'shopify_unavailable'
 */
async function getMemberOrders(memberId, opts = {}) {
  const { rows } = await query(
    'SELECT email, email_verified FROM members WHERE id = $1',
    [memberId]
  );
  const m = rows[0];
  const email = m && m.email ? String(m.email).trim().toLowerCase() : '';
  if (!email || email.indexOf('@') < 1) return _result([], 'no_email');
  if (m.email_verified !== true) return _result([], 'email_unverified');
  if (!shopify.isConfigured()) return _result([], 'not_configured');

  const key = memberId + '|' + email;
  const hit = _cache.get(key);
  // `fresh` still honours a 5s floor so a polling client can't turn
  // every tap into a Shopify call.
  const maxAge = opts.fresh ? FRESH_FLOOR_MS : CACHE_TTL_MS;
  if (hit && Date.now() - hit.at < maxAge) return hit.value;

  let nodes;
  try {
    nodes = await shopify.listOrdersByEmail(email, { first: 50 });
  } catch (e) {
    // ACCESS_DENIED = the token still lacks read_orders / Email access.
    // Logged without the member's email.
    console.warn('[memberOrders] Shopify order lookup failed:', e.code || '', (e.shopifyCodes || []).join(','));
    return _result([], 'shopify_unavailable');
  }

  const mine = nodes.filter((o) => typeof o.email === 'string' && o.email.trim().toLowerCase() === email);
  const value = _result(mine.map(toOrderDto), null);
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, { at: Date.now(), value });
  return value;
}

function _clearCache() { _cache.clear(); }

module.exports = { getMemberOrders, toOrderDto, deriveStatus, STATUS_LABEL, _clearCache };
