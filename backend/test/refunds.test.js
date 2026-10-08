/**
 * Refunds — routing rules, "email once", the branded email and the admin
 * Refunds list, with a stubbed database (no real DB needed).
 *
 * Founder 2026-10-08: refunds go back the way they were paid (points →
 * points, card → card, wallet → wallet, mixed split the same way), never
 * twice, with one branded email per refund; plus an admin Refunds list.
 *
 * The same rules run end to end against a real Postgres engine in
 * refunds.integration.test.js (needs PGlite; skipped without it).
 */
// describe / it / expect / vi are injected as globals by Vitest.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const app = require('../src/server');
const refunds = require('../src/services/refunds');
const billing = require('../src/services/billing');
const emailService = require('../src/services/email');
const { _cancelAndMaybeRefund } = require('../src/routes/bookings');

const ADMIN_ID  = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const token = (sub = ADMIN_ID) => jwt.sign({ sub }, process.env.JWT_SECRET, { expiresIn: '1h' });

/**
 * Fake pool. Records every statement; answers the handful the refund
 * paths depend on. opts.claimed=false → the cancel claim matches nothing
 * (someone else cancelled first). opts.admin=false → caller is a member.
 */
function stubDb(opts = {}) {
  const calls = [];
  let emailClaims = 0;
  const fakeQuery = async (text, params = []) => {
    const sql = String(text);
    calls.push({ sql, params });
    if (/SELECT id, first_name, last_name, email, is_admin/.test(sql)) {
      return { rows: [{ id: params[0], first_name: 'Ad', last_name: 'Min', email: 'a@x.io',
        is_admin: opts.admin !== false, is_ambassador: false, is_coach: false, is_banned: false }] };
    }
    if (/UPDATE bookings\s+SET status='cancelled'/.test(sql)) {
      return opts.claimed === false ? { rows: [], rowCount: 0 } : { rows: [{ id: params[0] }], rowCount: 1 };
    }
    if (/^\s*INSERT INTO refunds/.test(sql)) {
      const cols = sql.match(/INSERT INTO refunds \(([^)]+)\)/)[1].split(',').map((c) => c.trim());
      const row = { id: 'rf-' + calls.length, attempts: 1 };
      cols.forEach((c, i) => { row[c] = params[i]; });
      return { rows: [row], rowCount: 1 };
    }
    if (/SELECT points_balance FROM members/.test(sql)) return { rows: [{ points_balance: 900 }] };
    if (/UPDATE refunds SET email_sent_at=NOW\(\)/.test(sql)) {
      emailClaims += 1;
      return emailClaims === 1
        ? { rows: [{ id: params[0], member_id: MEMBER_ID, method: 'points', points: 100, status: 'refunded' }] }
        : { rows: [] };
    }
    if (/SELECT id, first_name, email FROM members/.test(sql)) {
      return { rows: [{ id: MEMBER_ID, first_name: 'Sara', email: 'sara@example.com' }] };
    }
    if (/FROM refunds r/.test(sql) && /COUNT\(\*\)::int AS count/.test(sql)) {
      return { rows: [{ count: 1, card_aed: '50.00', wallet_aed: '0', points_refunded: 100, refunded: 1,
        failed: 0, pending: 0, released: 0, released_aed: '0', other_currency_rows: [] }] };
    }
    if (/FROM refunds r/.test(sql)) return { rows: opts.listRows || [] };
    return { rows: [], rowCount: 1 };
  };
  db.pool.query = fakeQuery;
  db.pool.connect = async () => ({ query: fakeQuery, release() {} });
  return calls;
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();

// ── Pure rules ──────────────────────────────────────────────────
describe('splitMixedRefund — back the way it was paid', () => {
  it('full refund returns exactly what was paid (all points, all wallet AED)', () => {
    expect(refunds.splitMixedRefund({ priceAed: 100, pointsUsed: 500, refundAed: 100 })).toEqual({ points: 500, walletAed: 50 });
  });
  it('partial refund keeps the same proportion — not points first', () => {
    expect(refunds.splitMixedRefund({ priceAed: 100, pointsUsed: 500, refundAed: 50 })).toEqual({ points: 250, walletAed: 25 });
  });
  it('points-only stays points; wallet-only stays wallet', () => {
    expect(refunds.splitMixedRefund({ priceAed: 100, pointsUsed: 1000, refundAed: 100 })).toEqual({ points: 1000, walletAed: 0 });
    expect(refunds.splitMixedRefund({ priceAed: 100, pointsUsed: 0, refundAed: 100 })).toEqual({ points: 0, walletAed: 100 });
  });
  it('nothing refunded → nothing moves', () => {
    expect(refunds.splitMixedRefund({ priceAed: 100, pointsUsed: 500, refundAed: 0 })).toEqual({ points: 0, walletAed: 0 });
  });
  it('labels the method', () => {
    expect(refunds.methodFor(250, 25)).toBe('mixed');
    expect(refunds.methodFor(100, 0)).toBe('points');
    expect(refunds.methodFor(0, 90)).toBe('wallet');
  });
});

describe('bookingRefundKey — one refund per payment', () => {
  it('differs per payment of the same booking, stable for the same payment', () => {
    const a = refunds.bookingRefundKey({ id: 'b1', payment_method: 'stripe', stripe_payment_intent_id: 'pi_1' });
    const b = refunds.bookingRefundKey({ id: 'b1', payment_method: 'stripe', stripe_payment_intent_id: 'pi_2' });
    expect(a).not.toBe(b);
    expect(a).toBe(refunds.bookingRefundKey({ id: 'b1', payment_method: 'stripe', stripe_payment_intent_id: 'pi_1' }));
    expect(refunds.bookingRefundKey({ id: 'b1', payment_method: 'points', paid_at: '2026-10-01T10:00:00Z' }))
      .toBe('booking:b1:points:' + Date.parse('2026-10-01T10:00:00Z'));
  });
});

// ── Routing through the real cancel flow ────────────────────────
describe('_cancelAndMaybeRefund — routing', () => {
  let stripeSpy, emailSpy;
  beforeEach(() => {
    stripeSpy = vi.spyOn(billing, 'refundStripeBooking').mockResolvedValue(
      { id: 're_1', amount: 5000, currency: 'aed', payment_intent: 'pi_1' });
    emailSpy = vi.spyOn(emailService, 'sendRefundConfirmation').mockResolvedValue({ ok: true });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const pointsBooking = { id: 'bk-p', member_id: MEMBER_ID, session_id: 's1', session_name: 'Padel', status: 'confirmed',
    scheduled_at: future(72), payment_method: 'points', points_paid: 100, paid_at: new Date().toISOString() };
  const cardBooking = { id: 'bk-c', member_id: MEMBER_ID, session_id: 's1', session_name: 'Padel', status: 'confirmed',
    scheduled_at: future(72), payment_method: 'stripe', payment_amount: '50.00', payment_currency: 'AED',
    stripe_session_id: 'cs_1', stripe_payment_intent_id: 'pi_1', paid_at: new Date().toISOString() };

  it('points → points: a ledger credit, never a Stripe refund', async () => {
    const calls = stubDb();
    const out = await _cancelAndMaybeRefund(pointsBooking, { byAdmin: false, forceRefund: false });
    expect(out.response).toMatchObject({ refund_status: 'refunded', refund_method: 'points', refunded_points: 100, refunded_amount: 0 });
    expect(stripeSpy).not.toHaveBeenCalled();
    const led = calls.find((c) => /INSERT INTO points_ledger/.test(c.sql));
    expect(led.params[1]).toBe(100);           // +100 points
    expect(led.params[2]).toBe(1000);          // 900 + 100
    expect(led.sql).toMatch(/remaining/);      // live for FIFO
    const row = calls.find((c) => /^\s*INSERT INTO refunds/.test(c.sql));
    expect(row.sql).toBeTruthy();
    expect(row.params).toContain('points');
    expect(row.params).not.toContain('card');
  });

  it('card → card: one Stripe refund on the original payment, no points', async () => {
    const calls = stubDb();
    const out = await _cancelAndMaybeRefund(cardBooking, { byAdmin: false, forceRefund: false });
    expect(out.response).toMatchObject({ refund_status: 'refunded', refund_method: 'stripe', refunded_amount: 50, refunded_points: 0 });
    expect(stripeSpy).toHaveBeenCalledTimes(1);
    expect(stripeSpy.mock.calls[0][1].atpRefundId).toBeTruthy();
    expect(calls.some((c) => /INSERT INTO points_ledger/.test(c.sql))).toBe(false);
  });

  it('lost the race (already cancelled elsewhere) → no refund of any kind', async () => {
    const calls = stubDb({ claimed: false });
    const out = await _cancelAndMaybeRefund(pointsBooking, { byAdmin: false, forceRefund: false });
    expect(out.alreadyCancelled).toBe(true);
    expect(calls.some((c) => /INSERT INTO points_ledger/.test(c.sql))).toBe(false);
    const out2 = await _cancelAndMaybeRefund(cardBooking, { byAdmin: false, forceRefund: false });
    expect(out2.alreadyCancelled).toBe(true);
    expect(stripeSpy).not.toHaveBeenCalled();
  });

  it('already refunded booking → nothing refunded again', async () => {
    const calls = stubDb();
    await _cancelAndMaybeRefund({ ...cardBooking, refunded_at: new Date(), stripe_refund_id: 're_old' }, { byAdmin: true, forceRefund: true });
    await _cancelAndMaybeRefund({ ...pointsBooking, refunded_at: new Date() }, { byAdmin: true, forceRefund: true });
    expect(stripeSpy).not.toHaveBeenCalled();
    expect(calls.some((c) => /INSERT INTO points_ledger/.test(c.sql))).toBe(false);
  });

  it('inside 12h → forfeited (unchanged policy) unless an admin forces it', async () => {
    stubDb();
    const near = { ...pointsBooking, scheduled_at: future(3) };
    let out = await _cancelAndMaybeRefund(near, { byAdmin: false, forceRefund: false });
    expect(out.response.refund_status).toBe('forfeited_outside_window');
    out = await _cancelAndMaybeRefund(near, { byAdmin: true, forceRefund: true });
    expect(out.response.refunded_points).toBe(100);
  });

  it('a Stripe failure is reported and logged as failed (retryable), no email', async () => {
    const calls = stubDb();
    stripeSpy.mockRejectedValueOnce(new Error('card_declined'));
    const out = await _cancelAndMaybeRefund(cardBooking, { byAdmin: false, forceRefund: false });
    expect(out.response.refund_status).toBe('failed');
    await settle();
    const failed = calls.find((c) => /UPDATE refunds SET status=\$2/.test(c.sql) && c.params[1] === 'failed');
    expect(failed).toBeTruthy();
    expect(emailSpy).not.toHaveBeenCalled();
  });
});

describe('notifyRefund — exactly one email per refund', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('sends once; a second trigger finds the claim taken', async () => {
    stubDb();
    const spy = vi.spyOn(emailService, 'sendRefundConfirmation').mockResolvedValue({ ok: true });
    expect(await refunds.notifyRefund('rf-1')).toEqual({ sent: true });
    expect(await refunds.notifyRefund('rf-1')).toMatchObject({ sent: false });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('a failed delivery releases the claim (shown as "not sent", can go later)', async () => {
    const calls = stubDb();
    vi.spyOn(emailService, 'sendRefundConfirmation').mockResolvedValue({ ok: false, code: 'EMAIL_SEND_FAILED', reason: 'boom' });
    const out = await refunds.notifyRefund('rf-1');
    expect(out.sent).toBe(false);
    expect(calls.some((c) => /SET email_sent_at=NULL, email_error=\$2/.test(c.sql))).toBe(true);
  });
});

// ── The email itself ────────────────────────────────────────────
describe('buildRefundEmail — new-look refund confirmation', () => {
  const member = { first_name: 'Sara', email: 'sara@example.com' };
  const base = { id: '3f2a9c71-5b1e-4c8d-9a0f-2b7c6d1e8f90', description: 'Padel <b>Social</b>',
    item_at: '2026-10-12T15:00:00Z', refunded_at: '2026-10-08T09:30:00Z', source_type: 'session_booking' };

  it('card: "on its way", amount, card, reference, 5–10 business days, html + text', () => {
    const e = emailService.buildRefundEmail(member, { ...base, method: 'card', amount: '75.00', currency: 'AED',
      stripe_refund_id: 're_123', card_brand: 'visa', card_last4: '4242' });
    expect(e.subject).toBe('Refund on its way: AED 75.00 · Padel <b>Social</b>');
    expect(e.html).toMatch(/Your refund is on its/);
    expect(e.html).toMatch(/AED 75\.00/);
    expect(e.html).toMatch(/Visa ending 4242/);
    expect(e.html).toMatch(/re_123/);
    expect(e.html).toMatch(/5–10 business days/);
    expect(e.html).toMatch(/Mon, 12 Oct 2026, 7:00 pm/); // Asia/Dubai
    expect(e.html).toMatch(/profile\.html#sessions/);
    expect(e.html).toMatch(/wa\.me\/971585792378/);
    expect(e.html).toMatch(/Never Train Alone\./);
    expect(e.html).not.toMatch(/<b>Social<\/b>/);       // member/admin text is escaped
    expect(e.html).toMatch(/Padel &lt;b&gt;Social&lt;\/b&gt;/);
    expect(e.text).toMatch(/AED 75\.00/);
    expect(e.text).not.toMatch(/<(table|td|p|a|span|img)\b/i); // plain text, no markup
    expect(e.text).toMatch(/Reference: re_123/);
  });

  it('points: "your points are back", points (not money), available now', () => {
    const e = emailService.buildRefundEmail(member, { ...base, method: 'points', points: 120, points_balance: 120 });
    expect(e.html).toMatch(/Your points are/);
    expect(e.html).toMatch(/\+120 pts/);
    expect(e.html).toMatch(/Available now/);
    expect(e.html).not.toMatch(/AED/);
    expect(e.html).not.toMatch(/business days/);
    expect(e.html).toMatch(/ATP-RF-3F2A9C71/);
  });

  it('wallet: "topped back up"', () => {
    const e = emailService.buildRefundEmail(member, { ...base, method: 'wallet', amount: 90, currency: 'AED', source_type: 'coach_session' });
    expect(e.html).toMatch(/Your wallet is topped/);
    expect(e.html).toMatch(/AED 90\.00/);
    expect(e.html).toMatch(/ATP wallet/);
  });
});

// ── Admin Refunds list ──────────────────────────────────────────
describe('GET /api/admin/refunds', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/admin/refunds');
    expect(res.status).toBe(401);
  });

  it('is admin-only', async () => {
    stubDb({ admin: false });
    const res = await request(app).get('/api/admin/refunds').set('Authorization', 'Bearer ' + token(MEMBER_ID));
    expect(res.status).toBe(403);
  });

  it('passes filters through as parameters (never interpolated) and returns totals', async () => {
    const calls = stubDb({ listRows: [{ id: 'r1', member_id: MEMBER_ID, first_name: 'Sara', last_name: 'K', email: 's@x.io',
      source_type: 'session_booking', source_id: 'bk1', description: 'Padel', method: 'card', amount: '50.00', currency: 'AED',
      status: 'failed', stripe_payment_intent_id: 'pi_9', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] });
    const res = await request(app)
      .get('/api/admin/refunds?method=points&status=failed&type=coach_session&search=50%25_off&from=2026-10-01&to=2026-10-08&page=2&limit=10')
      .set('Authorization', 'Bearer ' + token());
    expect(res.status).toBe(200);
    const list = calls.find((c) => /FROM refunds r/.test(c.sql) && /ORDER BY/.test(c.sql));
    expect(list.sql).toMatch(/r\.method IN \('points','mixed'\)/);
    expect(list.sql).not.toMatch(/50%_off|2026-10-01/);
    expect(list.params).toEqual(expect.arrayContaining(['2026-10-01', '2026-10-08', 'failed', 'coach_session', '%50\\%\\_off%', 10, 10]));
    expect(res.body.totals).toMatchObject({ count: 1, aed_refunded: 50, card_aed: 50, points_refunded: 100 });
    expect(res.body.refunds[0]).toMatchObject({
      status: 'failed',
      stripe_payment_url: 'https://dashboard.stripe.com/payments/pi_9',
      retry: { booking_id: 'bk1', endpoint: '/api/bookings/bk1/retry-refund' },
    });
    expect(res.body.shopify.note).toBe('Online store refunds: see Shopify admin');
  });

  it('ignores unknown filter values', async () => {
    const calls = stubDb();
    await request(app).get("/api/admin/refunds?method=cash';--&status=lost&from=yesterday").set('Authorization', 'Bearer ' + token());
    const list = calls.find((c) => /FROM refunds r/.test(c.sql) && /ORDER BY/.test(c.sql));
    expect(list.sql).toMatch(/WHERE true/);
  });

  it('exports CSV', async () => {
    stubDb({ listRows: [{ id: 'r1', member_id: MEMBER_ID, first_name: '=cmd', last_name: 'X', email: 's@x.io',
      source_type: 'challenge_entry', method: 'points', points: 50, status: 'refunded', created_at: new Date().toISOString() }] });
    const res = await request(app).get('/api/admin/refunds?format=csv').set('Authorization', 'Bearer ' + token());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\n')[0]).toMatch(/^date,member_name,member_email,member_number,member_id,type/);
    expect(res.text).toMatch(/'=cmd X/); // spreadsheet formula neutralised
  });
});

describe('POST /api/bookings/:id/retry-refund', () => {
  it('is admin-only', async () => {
    stubDb({ admin: false });
    const res = await request(app).post('/api/bookings/bk1/retry-refund').set('Authorization', 'Bearer ' + token(MEMBER_ID));
    expect(res.status).toBe(403);
  });
});
