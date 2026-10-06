/**
 * GET /api/store/orders — member order history (founder items 7 + 8).
 *
 * No real Postgres or Shopify: the pg pool is spied with a tiny members
 * table and global fetch stands in for the Shopify Admin API. The fake
 * Shopify deliberately IGNORES the email search and returns every order
 * in the shop, so these tests prove the route's own exact-email check is
 * what keeps one member from ever seeing another's orders.
 */
// describe / it / expect / vi are injected as globals by Vitest.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const app = require('../src/server');
const memberOrders = require('../src/services/memberOrders');

const ALICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOB   = 'aaaaaaaa-0000-4000-8000-000000000002';
const NOMAIL = 'aaaaaaaa-0000-4000-8000-000000000003';
const UNVERIFIED = 'aaaaaaaa-0000-4000-8000-000000000004';

const MEMBERS = {
  [ALICE]:      { email: 'Alice@Example.com', email_verified: true },
  [BOB]:        { email: 'bob@example.com',   email_verified: true },
  [NOMAIL]:     { email: null,                email_verified: true },
  [UNVERIFIED]: { email: 'dana@example.com',  email_verified: false },
};

function order(name, email, extra = {}) {
  return {
    id: 'gid://shopify/Order/' + name.replace('#', ''),
    name, email,
    createdAt: '2026-10-05T18:23:08Z', processedAt: '2026-10-05T18:23:02Z', cancelledAt: null,
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
    statusPageUrl: 'https://shop.example/1/orders/' + name.replace('#', 't') + '/authenticate?key=k',
    totalPriceSet:         { presentmentMoney: { amount: '123.95', currencyCode: 'AED' } },
    subtotalPriceSet:      { presentmentMoney: { amount: '99.0', currencyCode: 'AED' } },
    totalShippingPriceSet: { presentmentMoney: { amount: '20.0', currencyCode: 'AED' } },
    lineItems: { nodes: [{
      title: 'Power Sculp Tank – Black', variantTitle: 'M', quantity: 1,
      image: { url: 'https://cdn.shopify.com/x.png' },
      discountedTotalSet: { presentmentMoney: { amount: '99.0', currencyCode: 'AED' } },
    }] },
    fulfillments: [],
    ...extra,
  };
}

// Every order in the "shop". Only #1001 and #1002 are Alice's.
const SHOP_ORDERS = [
  order('#1001', 'alice@example.com'),
  order('#1002', 'ALICE@EXAMPLE.COM'),
  order('#1003', 'bob@example.com'),
  order('#1004', 'alice@example.com.evil.io'),
  order('#1005', 'malice@example.com'),
  order('#1006', null),
  order('#1007', 'alice@example.co'),
];

function tokenFor(id) { return jwt.sign({ sub: id }, process.env.JWT_SECRET); }

function stubDb() {
  const fakeQuery = async (text, params = []) => {
    const sql = String(text);
    // authenticate middleware
    if (/is_banned/.test(sql) && /FROM members WHERE id = \$1/.test(sql)) {
      const m = MEMBERS[params[0]];
      return { rows: m ? [{ id: params[0], first_name: 'T', last_name: 'M', email: m.email, is_banned: false }] : [] };
    }
    // memberOrders
    if (/SELECT email, email_verified FROM members WHERE id = \$1/.test(sql)) {
      const m = MEMBERS[params[0]];
      return { rows: m ? [{ ...m }] : [] };
    }
    return { rows: [], rowCount: 0 };
  };
  vi.spyOn(db.pool, 'query').mockImplementation(fakeQuery);
  vi.spyOn(db.pool, 'connect').mockImplementation(async () => ({ query: fakeQuery, release() {} }));
}

/** Fake Shopify Admin GraphQL. Records each call's variables. */
function stubShopify(respond) {
  const calls = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), variables: body.variables });
    const payload = respond ? respond(body) : { data: { orders: { nodes: SHOP_ORDERS } } };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  });
  return { calls, spy };
}

const get = (id, qs = '') => request(app).get('/api/store/orders' + qs).set('Authorization', 'Bearer ' + tokenFor(id));

const saved = {};
beforeEach(() => {
  saved.domain = process.env.SHOPIFY_DOMAIN;
  saved.token = process.env.SHOPIFY_ADMIN_TOKEN;
  process.env.SHOPIFY_DOMAIN = 'atp-test.myshopify.com';
  process.env.SHOPIFY_ADMIN_TOKEN = 'test-admin-token';
  memberOrders._clearCache();
  stubDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (saved.domain === undefined) delete process.env.SHOPIFY_DOMAIN; else process.env.SHOPIFY_DOMAIN = saved.domain;
  if (saved.token === undefined) delete process.env.SHOPIFY_ADMIN_TOKEN; else process.env.SHOPIFY_ADMIN_TOKEN = saved.token;
});

describe('GET /api/store/orders — access', () => {
  it('401s without a token', async () => {
    const res = await request(app).get('/api/store/orders');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/store/orders — never another member\'s orders', () => {
  it('returns only orders whose email exactly matches the member (case-insensitive)', async () => {
    const { calls } = stubShopify();
    const res = await get(ALICE);
    expect(res.status).toBe(200);
    expect(res.body.reason).toBeNull();
    expect(res.body.orders.map((o) => o.number).sort()).toEqual(['#1001', '#1002']);
    // The Shopify search is scoped to the member's own (lower-cased) email.
    expect(calls).toHaveLength(1);
    expect(calls[0].variables.q).toBe('email:"alice@example.com"');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('gives Bob only his order — even straight after Alice filled the cache', async () => {
    stubShopify();
    await get(ALICE);
    const res = await get(BOB);
    expect(res.status).toBe(200);
    expect(res.body.orders.map((o) => o.number)).toEqual(['#1003']);
  });

  it('drops orders whose email Shopify blanked (no protected-data access)', async () => {
    stubShopify(() => ({ data: { orders: { nodes: SHOP_ORDERS.map((o) => ({ ...o, email: null })) } } }));
    const res = await get(ALICE);
    expect(res.body.orders).toEqual([]);
  });

  it('member with no email → empty list, Shopify never asked', async () => {
    const { spy } = stubShopify();
    const res = await get(NOMAIL);
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
    expect(res.body.reason).toBe('no_email');
    expect(spy).not.toHaveBeenCalled();
  });

  it('unverified email → empty list, Shopify never asked', async () => {
    const { spy } = stubShopify();
    const res = await get(UNVERIFIED);
    expect(res.body.orders).toEqual([]);
    expect(res.body.reason).toBe('email_unverified');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('GET /api/store/orders — Shopify not ready', () => {
  it('not configured → empty list with reason', async () => {
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    const { spy } = stubShopify();
    const res = await get(ALICE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orders: [], reason: 'not_configured' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('missing read_orders scope (ACCESS_DENIED) → empty list, still 200', async () => {
    stubShopify(() => ({ errors: [{ message: 'Access denied for orders field.', extensions: { code: 'ACCESS_DENIED' } }] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await get(ALICE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orders: [], reason: 'shopify_unavailable' });
    expect(res.body.account_orders_url).toBe('https://atp-test.myshopify.com/account');
    // The warning never carries the member's email.
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/alice/i);
  });
});

describe('GET /api/store/orders — caching', () => {
  it('serves a repeat visit from cache, and ?fresh=1 inside 5s still does not hammer Shopify', async () => {
    const { spy } = stubShopify();
    await get(ALICE);
    await get(ALICE);
    await get(ALICE, '?fresh=1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('?fresh=1 refetches once the 5s floor has passed', async () => {
    const { spy } = stubShopify();
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await get(ALICE);
    now.mockReturnValue(t0 + 6000);
    await get(ALICE, '?fresh=1');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('order shape', () => {
  it('maps items, totals, tracking and the order-status link', () => {
    const o = order('#1010', 'a@b.c', {
      displayFulfillmentStatus: 'FULFILLED',
      lineItems: { nodes: [{ title: 'Cap', variantTitle: 'Default Title', quantity: 2, image: null, discountedTotalSet: { presentmentMoney: { amount: '60.0', currencyCode: 'AED' } } }] },
      fulfillments: [{
        status: 'SUCCESS', displayStatus: 'IN_TRANSIT', createdAt: '2026-10-06T08:00:00Z', inTransitAt: '2026-10-06T09:00:00Z',
        deliveredAt: null, estimatedDeliveryAt: '2026-10-08T00:00:00Z',
        trackingInfo: [{ number: 'AX123', company: 'Aramex', url: 'https://aramex.example/AX123' }],
      }],
    });
    const dto = memberOrders.toOrderDto(o);
    expect(dto).toMatchObject({
      number: '#1010', status: 'shipped', status_label: 'On its way',
      currency: 'AED', total: 123.95, subtotal: 99, shipping: 20,
      track_url: 'https://aramex.example/AX123',
      order_status_url: o.statusPageUrl,
    });
    expect(dto.items).toEqual([{ title: 'Cap', variant: null, quantity: 2, image_url: null, total: 60 }]);
    expect(dto.tracking).toEqual([{ number: 'AX123', company: 'Aramex', url: 'https://aramex.example/AX123' }]);
    expect(dto).not.toHaveProperty('email');
  });

  it('falls back to the order-status page when nothing has shipped', () => {
    const dto = memberOrders.toOrderDto(order('#1011', 'a@b.c'));
    expect(dto.status).toBe('processing');
    expect(dto.track_url).toBe(dto.order_status_url);
  });

  it('buckets statuses', () => {
    const s = (extra) => memberOrders.deriveStatus(order('#1', 'a@b.c', extra));
    expect(s({ cancelledAt: '2026-10-06T00:00:00Z', displayFinancialStatus: 'REFUNDED' })).toBe('cancelled');
    expect(s({ displayFinancialStatus: 'VOIDED' })).toBe('cancelled');
    expect(s({ displayFinancialStatus: 'REFUNDED' })).toBe('refunded');
    expect(s({ displayFinancialStatus: 'PENDING' })).toBe('pending_payment');
    expect(s({ fulfillments: [{ status: 'SUCCESS', displayStatus: 'DELIVERED', deliveredAt: '2026-10-07T00:00:00Z', trackingInfo: [] }] })).toBe('delivered');
    expect(s({ fulfillments: [{ status: 'CANCELLED', displayStatus: 'CANCELED', trackingInfo: [] }] })).toBe('processing');
  });
});
