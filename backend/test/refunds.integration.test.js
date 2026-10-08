/**
 * Refunds — end to end against a real Postgres engine (PGlite, embedded),
 * through the real routes and SQL. Stripe and the email sender are fakes:
 * nothing leaves the machine.
 *
 * PGlite is not a dependency of the backend, so this file skips itself
 * unless it can find it. To run it:
 *   PGLITE_DIR=/path/with/node_modules npx vitest run test/refunds.integration.test.js
 * (any directory whose node_modules has @electric-sql/pglite).
 *
 * What it pins (founder 2026-10-08):
 *   - points → points, card → card, wallet → wallet, mixed split the way
 *     it was paid; never points refunded as money or vice versa;
 *   - no double refunds (double cancel, rebook, retry, webhook echo);
 *   - exactly one refund email per refund;
 *   - the admin Refunds list (admin-only, filters, totals, CSV).
 */
const path = require('path');
const fs = require('fs');

const BACKEND = path.join(__dirname, '..');
let PGLITE_MAIN = null;
try {
  PGLITE_MAIN = require.resolve('@electric-sql/pglite', {
    paths: [process.env.PGLITE_DIR || BACKEND, BACKEND],
  });
} catch (e) { PGLITE_MAIN = null; }

// ── Fake Stripe (installed before services/billing first needs it) ──
const stripeCalls = { refunds: [], list: [] };
let stripeFailNext = null;
let refundSeq = 0;
const fakeStripe = {
  refunds: {
    create: async (params, opts) => {
      stripeCalls.refunds.push({ params, opts });
      if (stripeFailNext) { const e = new Error(stripeFailNext); stripeFailNext = null; throw e; }
      refundSeq += 1;
      return { id: 're_test_' + refundSeq, amount: 5000, currency: 'aed',
               payment_intent: params.payment_intent, metadata: params.metadata, status: 'succeeded' };
    },
    list: async (params) => { stripeCalls.list.push(params); return { data: fakeStripe._list || [] }; },
  },
  checkout: { sessions: { retrieve: async () => ({ payment_intent: 'pi_from_checkout' }) } },
  paymentIntents: { cancel: async () => ({ status: 'canceled' }), capture: async () => ({ status: 'succeeded' }) },
  customers: { retrieve: async () => ({ id: 'cus_x' }), create: async () => ({ id: 'cus_x' }) },
  ephemeralKeys: { create: async () => ({ secret: 'ek' }) },
};

describe.runIf(!!PGLITE_MAIN)('refunds — integration (PGlite)', () => {
  let pg, app, request, jwt, refunds, billing, emailService;
  const emails = [];
  const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';
  const SARA = 'bbbbbbbb-0000-4000-8000-000000000002';
  const OMAR = 'cccccccc-0000-4000-8000-000000000003';
  const COACH = 'dddddddd-0000-4000-8000-000000000004';
  let CITY, S_FAR, S_NEAR, S_FULL;
  const tok = (sub) => ({ Authorization: 'Bearer ' + jwt.sign({ sub }, process.env.JWT_SECRET, { expiresIn: '1h' }) });
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const one = async (sql, params) => (await pg.query(sql, params || [])).rows[0];
  const all = async (sql, params) => (await pg.query(sql, params || [])).rows;
  const balance = async (id) => (await one('SELECT points_balance FROM members WHERE id=$1', [id])).points_balance;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_refund_tests';
    const stripePath = require.resolve('stripe', { paths: [BACKEND] });
    require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: function FakeStripe() { return fakeStripe; } };

    const { PGlite } = require(PGLITE_MAIN);
    const contrib = (n) => require(require.resolve('@electric-sql/pglite/contrib/' + n, { paths: [path.dirname(PGLITE_MAIN)] }));
    pg = new PGlite({
      extensions: { uuid_ossp: contrib('uuid_ossp').uuid_ossp, pg_trgm: contrib('pg_trgm').pg_trgm, pgcrypto: contrib('pgcrypto').pgcrypto },
      parsers: { 20: (v) => v, 1700: (v) => v }, // int8/numeric as strings, like node-pg
    });
    // Schema: schema.sql + every CREATE/ALTER the code runs (same as the
    // migrate endpoints + boot), a few passes for ordering.
    await pg.exec(fs.readFileSync(path.join(BACKEND, 'src/db/schema.sql'), 'utf8'));
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(path.join(BACKEND, 'src'));
    const ddl = [];
    for (const f of files) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/`([^`]*)`/gs)) {
        const s = m[1].trim();
        if (!s.includes('${') && /^(CREATE (UNIQUE )?INDEX|CREATE TABLE|ALTER TABLE)/i.test(s)) ddl.push(s);
      }
    }
    for (let pass = 0; pass < 4; pass++) for (const s of ddl) { try { await pg.exec(s); } catch (e) { /* next pass */ } }

    const db = require('../src/db');
    const adapt = async (text, params) => {
      const r = await pg.query(text, params || []);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    };
    db.pool.query = adapt;
    db.pool.connect = async () => ({ query: adapt, release() {} });

    app = require('../src/server');
    request = require('supertest');
    jwt = require('jsonwebtoken');
    refunds = require('../src/services/refunds');
    billing = require('../src/services/billing');
    emailService = require('../src/services/email');
    await refunds.ensureSchema();

    // Email: capture instead of sending (and prove the template renders).
    emailService.sendRefundConfirmation = async (member, refund) => {
      const built = emailService.buildRefundEmail(member, refund);
      emails.push({ to: member && member.email, method: refund.method, refund_id: refund.id, subject: built.subject, text: built.text });
      return { ok: true };
    };
    emailService.sendSessionCancellation = async () => {};
    emailService.sendBookingConfirmation = async () => {};
    emailService.sendPaidSessionReceipt = async () => {};

    await pg.exec(`ALTER TABLE members ALTER COLUMN member_number SET DEFAULT ('T' || substr(md5(random()::text),1,9))`);
    await pg.query(`INSERT INTO members (id, first_name, last_name, email, is_admin) VALUES ($1,'Admin','User','admin@x.test',true)`, [ADMIN]);
    await pg.query(`INSERT INTO members (id, first_name, last_name, email, points_balance) VALUES ($1,'Sara','Khan','sara@x.test',1000)`, [SARA]);
    await pg.query(`INSERT INTO members (id, first_name, last_name, email, points_balance) VALUES ($1,'Omar','B','omar@x.test',0)`, [OMAR]);
    await pg.query(`INSERT INTO members (id, first_name, last_name, email, is_coach) VALUES ($1,'Coach','Lina','coach@x.test',true)`, [COACH]);
    await pg.query(`INSERT INTO points_ledger (member_id, amount, balance, reason, description, remaining, expires_at) VALUES ($1,1000,1000,'admin','seed',1000,NOW()+interval '300 days')`, [SARA]);
    // Points were reset to 0 yesterday (as on 2026-10-07 in production).
    await pg.query(`INSERT INTO system_config (key, value) VALUES ('points_reset_at', to_jsonb($1::text))`,
      [new Date(Date.now() - 86400000).toISOString()]);
    CITY = (await one(`INSERT INTO cities (name) VALUES ('Dubai') RETURNING id`)).id;
    const mk = async (name, hours, extra = '') => (await one(
      `INSERT INTO sessions (name, city_id, location, session_type, scheduled_at, created_by, price, price_points, capacity)
       VALUES ($1,$2,'Al Barsha Park','paid', NOW() + ($3 || ' hours')::interval, $4, 50, 100, ${extra || 20}) RETURNING id`,
      [name, CITY, String(hours), ADMIN])).id;
    S_FAR = await mk('Padel Social', 72);
    S_NEAR = await mk('Sunrise Run', 6);
    S_FULL = await mk('Tiny Yoga', 48, '1');
  }, 120000);

  // Create a confirmed booking directly, as if it had been paid.
  async function paidBooking(memberId, sessionId, how, extra = {}) {
    const tokn = 'tok' + Math.random().toString(16).slice(2);
    if (how === 'points') {
      return (await one(
        `INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status, payment_method, points_paid, paid_at)
         VALUES ($1,$2,'{}',$3,'confirmed','points',100, COALESCE($4::timestamptz, NOW()))
         ON CONFLICT (member_id, session_id) DO UPDATE SET status='confirmed', payment_method='points', points_paid=100,
           paid_at=COALESCE($4::timestamptz, NOW()), refunded_at=NULL, stripe_refund_id=NULL
         RETURNING *`, [memberId, sessionId, tokn, extra.paid_at || null])).id;
    }
    return (await one(
      `INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status, payment_method, payment_amount,
                             payment_currency, stripe_session_id, stripe_payment_intent_id, paid_at)
       VALUES ($1,$2,'{}',$3,'confirmed','stripe',50,'AED',$4,$5,NOW())
       ON CONFLICT (member_id, session_id) DO UPDATE SET status='confirmed', payment_method='stripe', payment_amount=50,
         stripe_payment_intent_id=EXCLUDED.stripe_payment_intent_id, stripe_session_id=EXCLUDED.stripe_session_id,
         refunded_at=NULL, stripe_refund_id=NULL
       RETURNING *`, [memberId, sessionId, tokn, 'cs_' + (extra.pi || 'x'), extra.pi || 'pi_test_' + Math.random().toString(16).slice(2)])).id;
  }

  // ── Session bookings ───────────────────────────────────────────
  it('points booking → refunded in points (ledger + FIFO remaining), never via Stripe', async () => {
    await pg.query('UPDATE members SET points_balance=900 WHERE id=$1', [SARA]); // as if 100 were spent
    const id = await paidBooking(SARA, S_FAR, 'points');
    const before = stripeCalls.refunds.length;
    const r = await request(app).delete('/api/bookings/' + id).set(tok(SARA));
    expect(r.status).toBe(200);
    expect(r.body.refund_method).toBe('points');
    expect(r.body.refunded_points).toBe(100);
    expect(r.body.refunded_amount).toBe(0);
    expect(stripeCalls.refunds.length).toBe(before);
    expect(await balance(SARA)).toBe(1000);
    const led = await one(`SELECT amount, remaining, expires_at FROM points_ledger WHERE member_id=$1 AND reason='session_refund' ORDER BY created_at DESC LIMIT 1`, [SARA]);
    expect(led.amount).toBe(100);
    expect(led.remaining).toBe(100);
    expect(led.expires_at).toBeTruthy();
    const row = await one(`SELECT * FROM refunds WHERE source_id=$1`, [id]);
    expect(row).toMatchObject({ method: 'points', points: 100, status: 'refunded', amount: null, reason: 'member_cancel' });
    await settle();
    const mine = emails.filter((e) => e.refund_id === row.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].method).toBe('points');
    expect(mine[0].subject).toMatch(/100 points are back/);
    expect(mine[0].text).not.toMatch(/AED/);
  });

  it('double cancel → 400, no second refund, no second email', async () => {
    const id = (await one(`SELECT id FROM bookings WHERE member_id=$1 AND session_id=$2`, [SARA, S_FAR])).id;
    const sent = emails.length;
    const r = await request(app).delete('/api/bookings/' + id).set(tok(SARA));
    expect(r.status).toBe(400);
    expect(await balance(SARA)).toBe(1000);
    expect((await all(`SELECT id FROM refunds WHERE source_id=$1`, [id]))).toHaveLength(1);
    await settle();
    expect(emails.length).toBe(sent);
  });

  it('rebook + pay again + cancel → refunded again (old refund stamp no longer blocks it)', async () => {
    let r = await request(app).post('/api/bookings').set(tok(SARA)).send({ session_id: S_FAR });
    expect(r.status).toBe(202);
    const id = r.body.booking.id;
    expect((await one('SELECT refunded_at FROM bookings WHERE id=$1', [id])).refunded_at).toBeNull();
    r = await request(app).post(`/api/bookings/${id}/pay-with-points`).set(tok(SARA));
    expect(r.status).toBe(200);
    expect(await balance(SARA)).toBe(900);
    r = await request(app).delete('/api/bookings/' + id).set(tok(SARA));
    expect(r.body.refund_method).toBe('points');
    expect(await balance(SARA)).toBe(1000);
    expect((await all(`SELECT id FROM refunds WHERE source_id=$1 AND status='refunded'`, [id]))).toHaveLength(2);
  });

  it('card booking → refunded to card via Stripe (log row claimed first, metadata + idempotency key), email once', async () => {
    const id = await paidBooking(OMAR, S_FAR, 'card', { pi: 'pi_card_1' });
    const pts = await balance(OMAR);
    const r = await request(app).delete('/api/bookings/' + id).set(tok(OMAR));
    expect(r.status).toBe(200);
    expect(r.body.refund_method).toBe('stripe');
    expect(r.body.refunded_amount).toBe(50);
    expect(r.body.refunded_points).toBe(0);
    expect(await balance(OMAR)).toBe(pts); // never points for a card payment
    const call = stripeCalls.refunds[stripeCalls.refunds.length - 1];
    expect(call.params.payment_intent).toBe('pi_card_1');
    const row = await one(`SELECT * FROM refunds WHERE source_id=$1`, [id]);
    expect(call.params.metadata.atp_refund_id).toBe(row.id);
    expect(call.opts.idempotencyKey).toBe(`atp-refund-${row.id}-1`);
    expect(row).toMatchObject({ method: 'card', status: 'refunded', points: null });
    expect(row.stripe_refund_id).toMatch(/^re_test_/);
    expect(Number(row.amount)).toBe(50);
    const bk = await one('SELECT refunded_at, refund_method, stripe_refund_id FROM bookings WHERE id=$1', [id]);
    expect(bk.refund_method).toBe('stripe');
    expect(bk.stripe_refund_id).toBe(row.stripe_refund_id);
    await settle();
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(1);
    expect(emails.find((e) => e.refund_id === row.id).subject).toMatch(/Refund on its way: AED 50\.00/);
  });

  it('Stripe echo (charge.refunded for our own refund) → no new row, no second email, card details filled in', async () => {
    const row = await one(`SELECT * FROM refunds WHERE stripe_payment_intent_id='pi_card_1'`);
    const sent = emails.length;
    fakeStripe._list = [{ id: row.stripe_refund_id, amount: 5000, currency: 'aed', status: 'succeeded', metadata: { atp_refund_id: row.id, booking_id: row.source_id } }];
    await billing.handleWebhookEvent({ type: 'charge.refunded', data: { object: {
      id: 'ch_1', payment_intent: 'pi_card_1', amount_refunded: 5000, refunded: true, currency: 'aed',
      payment_method_details: { card: { brand: 'visa', last4: '4242' } } } } });
    await settle();
    expect(await all(`SELECT id FROM refunds WHERE stripe_payment_intent_id='pi_card_1'`)).toHaveLength(1);
    expect(emails.length).toBe(sent);
    expect((await one('SELECT card_brand, card_last4 FROM refunds WHERE id=$1', [row.id]))).toEqual({ card_brand: 'visa', card_last4: '4242' });
  });

  it('Stripe failure → failed row, no email; admin retry refunds once; second retry is idempotent', async () => {
    await pg.query(`INSERT INTO members (id, first_name, last_name, email) VALUES ('eeeeeeee-0000-4000-8000-000000000005','Nadia','R','nadia@x.test') ON CONFLICT DO NOTHING`);
    const NADIA = 'eeeeeeee-0000-4000-8000-000000000005';
    const id = await paidBooking(NADIA, S_FAR, 'card', { pi: 'pi_fail_1' });
    stripeFailNext = 'Your card was declined (simulated)';
    let r = await request(app).delete('/api/bookings/' + id).set(tok(NADIA));
    expect(r.body.refund_status).toBe('failed');
    let row = await one(`SELECT * FROM refunds WHERE source_id=$1`, [id]);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/declined/);
    await settle();
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(0);

    // Members can't retry.
    r = await request(app).post(`/api/bookings/${id}/retry-refund`).set(tok(NADIA));
    expect(r.status).toBe(403);

    // The admin list offers the retry.
    r = await request(app).get('/api/admin/refunds?status=failed').set(tok(ADMIN));
    const listed = r.body.refunds.find((x) => x.id === row.id);
    expect(listed.retry).toEqual({ booking_id: id, endpoint: `/api/bookings/${id}/retry-refund` });
    expect(listed.stripe_payment_url).toBe('https://dashboard.stripe.com/payments/pi_fail_1');

    const calls = stripeCalls.refunds.length;
    r = await request(app).post(`/api/bookings/${id}/retry-refund`).set(tok(ADMIN));
    expect(r.status).toBe(200);
    expect(stripeCalls.refunds.length).toBe(calls + 1);
    expect(stripeCalls.refunds[calls].opts.idempotencyKey).toBe(`atp-refund-${row.id}-2`);
    row = await one(`SELECT * FROM refunds WHERE id=$1`, [row.id]);
    expect(row.status).toBe('refunded');
    expect(await all(`SELECT id FROM refunds WHERE source_id=$1`, [id])).toHaveLength(1);
    await settle();
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(1);

    r = await request(app).post(`/api/bookings/${id}/retry-refund`).set(tok(ADMIN));
    expect(r.body.idempotent).toBe(true);
    expect(stripeCalls.refunds.length).toBe(calls + 1);
  });

  it('inside 12h → forfeited (policy unchanged): no refund, no row, no email', async () => {
    const id = await paidBooking(SARA, S_NEAR, 'points');
    const b = await balance(SARA);
    const r = await request(app).delete('/api/bookings/' + id).set(tok(SARA));
    expect(r.body.refund_status).toBe('forfeited_outside_window');
    expect(await balance(SARA)).toBe(b);
    expect(await all(`SELECT id FROM refunds WHERE source_id=$1`, [id])).toHaveLength(0);
  });

  it('points paid before the 2026-10-07 reset → still refunded in points, flagged for the admin', async () => {
    const id = await paidBooking(OMAR, S_FAR, 'points', { paid_at: new Date(Date.now() - 3 * 86400000).toISOString() });
    await pg.query('UPDATE bookings SET status=$2 WHERE id=$1', [id, 'confirmed']);
    const b = await balance(OMAR);
    const r = await request(app).delete('/api/bookings/' + id).set(tok(OMAR));
    expect(r.body.refund_method).toBe('points');
    expect(await balance(OMAR)).toBe(b + 100);
    const row = await one(`SELECT * FROM refunds WHERE source_id=$1 AND status='refunded' ORDER BY created_at DESC LIMIT 1`, [id]);
    expect(row.method).toBe('points');
    expect(row.paid_before_points_reset).toBe(true);
    // Bookings paid after the reset are not flagged.
    const recent = await one(`SELECT paid_before_points_reset FROM refunds WHERE reason='member_cancel' AND method='points' ORDER BY created_at LIMIT 1`);
    expect(recent.paid_before_points_reset).toBe(false);
  });

  it('admin cancels a whole session → points back as points, card back to card, unpaid just cancelled; once each', async () => {
    const S = (await one(
      `INSERT INTO sessions (name, city_id, location, session_type, scheduled_at, created_by, price, price_points, capacity)
       VALUES ('Beach Bootcamp',$1,'Kite Beach','paid', NOW() + interval '5 hours', $2, 50, 100, 20) RETURNING id`, [CITY, ADMIN])).id;
    const pBk = await paidBooking(SARA, S, 'points');
    const cBk = await paidBooking(OMAR, S, 'card', { pi: 'pi_sess_1' });
    await pg.query(`INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status) VALUES ($1,$2,'{}','pend_x1','pending_payment')`, [ADMIN, S]);
    const sara = await balance(SARA);
    const r = await request(app).patch(`/api/sessions/${S}/cancel`).set(tok(ADMIN)).send({ reason: 'Storm warning' });
    expect(r.status).toBe(200);
    expect(await balance(SARA)).toBe(sara + 100); // forced past the 12h rule
    const rows = await all(`SELECT source_id, method, status, reason FROM refunds WHERE source_id = ANY($1::text[]) ORDER BY method`, [[pBk, cBk]]);
    expect(rows).toEqual([
      { source_id: cBk, method: 'card', status: 'refunded', reason: 'session_cancelled' },
      { source_id: pBk, method: 'points', status: 'refunded', reason: 'session_cancelled' },
    ]);
    expect((await one(`SELECT status FROM bookings WHERE member_id=$1 AND session_id=$2`, [ADMIN, S])).status).toBe('cancelled');
    expect(r.body.refunds.find((x) => x.booking_id === cBk).refunded_amount).toBe(50);
    // Calling it again refunds nothing more.
    const again = await request(app).patch(`/api/sessions/${S}/cancel`).set(tok(ADMIN)).send({});
    expect(again.body.refunds).toHaveLength(0);
    expect(await balance(SARA)).toBe(sara + 100);
  });

  it('series cancel now cancels + refunds the bookings too', async () => {
    const mkS = async (h) => (await one(
      `INSERT INTO sessions (name, city_id, location, session_type, scheduled_at, created_by, price, price_points, capacity)
       VALUES ('Tuesday Tennis',$1,'Zabeel','paid', NOW() + ($2 || ' hours')::interval, $3, 50, 100, 20) RETURNING id`, [CITY, String(h), ADMIN])).id;
    const a = await mkS(30); await mkS(200);
    const bk = await paidBooking(SARA, a, 'points');
    const before = await balance(SARA);
    const r = await request(app).patch('/api/sessions/series/cancel').set(tok(ADMIN)).send({ name: 'Tuesday Tennis', city_id: CITY });
    expect(r.body.cancelled).toBe(2);
    expect((await one('SELECT status FROM bookings WHERE id=$1', [bk])).status).toBe('cancelled');
    expect(await balance(SARA)).toBe(before + 100);
  });

  it('dashboard refund (charge.refunded, not ours) → logged + one email; redelivery adds nothing; later cancel does not refund again', async () => {
    const id = await paidBooking(SARA, S_FULL, 'card', { pi: 'pi_dash_1' });
    fakeStripe._list = [{ id: 're_dash_1', amount: 5000, currency: 'aed', status: 'succeeded', metadata: {}, created: Math.floor(Date.now() / 1000) }];
    const ev = { type: 'charge.refunded', data: { object: {
      id: 'ch_dash', payment_intent: 'pi_dash_1', amount_refunded: 5000, refunded: true, currency: 'aed',
      payment_method_details: { card: { brand: 'mastercard', last4: '5454' } } } } };
    await billing.handleWebhookEvent(ev);
    await settle();
    const row = await one(`SELECT * FROM refunds WHERE stripe_refund_id='re_dash_1'`);
    expect(row).toMatchObject({ source_type: 'session_booking', source_id: id, method: 'card', status: 'refunded', reason: 'stripe_dashboard', card_last4: '5454' });
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(1);
    await billing.handleWebhookEvent(ev);
    await settle();
    expect(await all(`SELECT id FROM refunds WHERE stripe_payment_intent_id='pi_dash_1'`)).toHaveLength(1);
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(1);
    const calls = stripeCalls.refunds.length;
    const r = await request(app).delete('/api/bookings/' + id).set(tok(SARA));
    expect(r.status).toBe(200);
    expect(stripeCalls.refunds.length).toBe(calls);
  });

  it('paid by card while the session filled → auto-refund logged once with a reason, one email; redelivery is a no-op', async () => {
    await paidBooking(OMAR, S_FULL, 'points'); // takes the only seat (capacity 1)
    await pg.query(`INSERT INTO members (id, first_name, last_name, email) VALUES ('ffffffff-0000-4000-8000-000000000006','Lee','K','lee@x.test') ON CONFLICT DO NOTHING`);
    const LEE = 'ffffffff-0000-4000-8000-000000000006';
    const bk = (await one(`INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status) VALUES ($1,$2,'{}','pend_lee','pending_payment') RETURNING id`, [LEE, S_FULL])).id;
    const ev = { type: 'checkout.session.completed', data: { object: {
      id: 'cs_full_1', mode: 'payment', payment_intent: 'pi_full_1', amount_total: 5000, currency: 'aed',
      metadata: { type: 'session_booking', booking_id: bk } } } };
    const calls = stripeCalls.refunds.length;
    await billing.handleWebhookEvent(ev);
    await settle();
    expect(stripeCalls.refunds.length).toBe(calls + 1);
    const b = await one('SELECT status, payment_method, stripe_payment_intent_id, refunded_at, paid_at FROM bookings WHERE id=$1', [bk]);
    expect(b).toMatchObject({ status: 'payment_failed', payment_method: 'stripe', stripe_payment_intent_id: 'pi_full_1', paid_at: null });
    expect(b.refunded_at).toBeTruthy();
    const row = await one(`SELECT * FROM refunds WHERE source_id=$1`, [bk]);
    expect(row).toMatchObject({ status: 'refunded', reason: 'session_full', method: 'card' });
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(1);
    expect(emails.find((e) => e.refund_id === row.id).text).toMatch(/filled up while you were paying/);
    await billing.handleWebhookEvent(ev);
    await settle();
    expect(stripeCalls.refunds.length).toBe(calls + 1);
  });

  // ── Coach 1-on-1 (wallet + points) ─────────────────────────────
  it('coach booking paid with points + wallet → full refund splits back exactly; coach pending released', async () => {
    const off = (await one(`INSERT INTO coach_offerings (coach_id, title, duration_min, price_aed) VALUES ($1,'Strength 1-on-1',60,100) RETURNING id`, [COACH])).id;
    await pg.query(`INSERT INTO member_wallet (member_id, balance_aed) VALUES ($1, 200) ON CONFLICT (member_id) DO UPDATE SET balance_aed=200`, [SARA]);
    const pts = await balance(SARA);
    let r = await request(app).post('/api/coach-sessions/book').set(tok(SARA)).send({
      offering_id: off, scheduled_at: new Date(Date.now() + 5 * 86400000).toISOString(), points_to_use: 500,
    });
    expect(r.status).toBe(200);
    const id = r.body.booking.id;
    expect(await balance(SARA)).toBe(pts - 500);
    expect((await one('SELECT balance_aed FROM member_wallet WHERE member_id=$1', [SARA])).balance_aed).toBe(150);
    expect((await one('SELECT pending_aed FROM member_wallet WHERE member_id=$1', [COACH])).pending_aed).toBe(90);

    r = await request(app).post(`/api/coach-sessions/${id}/cancel`).set(tok(SARA)).send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ refund_aed: 100, refunded_points: 500, refunded_wallet_aed: 50 });
    expect(await balance(SARA)).toBe(pts);
    expect((await one('SELECT balance_aed FROM member_wallet WHERE member_id=$1', [SARA])).balance_aed).toBe(200);
    expect((await one('SELECT pending_aed FROM member_wallet WHERE member_id=$1', [COACH])).pending_aed).toBe(0);
    const row = await one(`SELECT * FROM refunds WHERE source_id=$1`, [id]);
    expect(row).toMatchObject({ method: 'mixed', points: 500, status: 'refunded' });
    expect(Number(row.amount)).toBe(50);
    await settle();
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(1);

    // Cancelling again: refused, nothing moves.
    r = await request(app).post(`/api/coach-sessions/${id}/cancel`).set(tok(SARA)).send({});
    expect(r.status).toBe(400);
    expect(await balance(SARA)).toBe(pts);
  });

  it('coach booking cancelled 2-24h ahead → 50% back, split in the same proportion (not points first)', async () => {
    const off = (await one(`SELECT id FROM coach_offerings WHERE coach_id=$1 LIMIT 1`, [COACH])).id;
    const pts = await balance(SARA);
    let r = await request(app).post('/api/coach-sessions/book').set(tok(SARA)).send({
      offering_id: off, scheduled_at: new Date(Date.now() + 10 * 3600000).toISOString(), points_to_use: 500,
    });
    const id = r.body.booking.id;
    r = await request(app).post(`/api/coach-sessions/${id}/cancel`).set(tok(SARA)).send({});
    expect(r.body).toMatchObject({ refund_aed: 50, refunded_points: 250, refunded_wallet_aed: 25, coach_kept_aed: 45 });
    expect(await balance(SARA)).toBe(pts - 250);
    expect((await one('SELECT pending_aed, balance_aed FROM member_wallet WHERE member_id=$1', [COACH]))).toEqual({ pending_aed: 0, balance_aed: 45 });
  });

  it('unredeemed gift cancelled by the sender → full refund, coach is not paid', async () => {
    const off = (await one(`SELECT id FROM coach_offerings WHERE coach_id=$1 LIMIT 1`, [COACH])).id;
    const wallet = async () => (await one('SELECT balance_aed FROM member_wallet WHERE member_id=$1', [SARA])).balance_aed;
    const w0 = await wallet();
    let r = await request(app).post('/api/coach-sessions/book').set(tok(SARA)).send({ offering_id: off, is_gift: true, gift_recipient_id: OMAR });
    expect(r.status).toBe(200);
    const coach0 = await one('SELECT pending_aed, balance_aed FROM member_wallet WHERE member_id=$1', [COACH]);
    r = await request(app).post(`/api/coach-sessions/${r.body.booking.id}/cancel`).set(tok(SARA)).send({});
    expect(r.body.refund_aed).toBe(100);
    expect(await wallet()).toBe(w0);
    expect(await one('SELECT pending_aed, balance_aed FROM member_wallet WHERE member_id=$1', [COACH])).toEqual(coach0);
  });

  // ── Challenges ─────────────────────────────────────────────────
  it('challenge cancelled → entry fees back in points, once', async () => {
    const c = (await one(
      `INSERT INTO challenges (title, challenge_type, metric, target, unit, starts_at, ends_at, created_by, status, entry_cost_points)
       VALUES ('October 100k','monthly','km',100,'km',NOW(),NOW()+interval '20 days',$1,'active',50) RETURNING id`, [ADMIN])).id;
    const b = await balance(SARA);
    let r = await request(app).post(`/api/challenges/${c}/join`).set(tok(SARA));
    expect(r.status).toBe(201);
    expect(await balance(SARA)).toBe(b - 50);
    r = await request(app).patch(`/api/challenges/${c}/cancel`).set(tok(ADMIN));
    expect(r.body.refunded_count).toBe(1);
    expect(await balance(SARA)).toBe(b);
    const row = await one(`SELECT * FROM refunds WHERE source_type='challenge_entry' ORDER BY created_at DESC LIMIT 1`);
    expect(row).toMatchObject({ method: 'points', points: 50, reason: 'challenge_cancelled' });
    await settle();
    expect(emails.filter((e) => e.refund_id === row.id)).toHaveLength(1);
    r = await request(app).patch(`/api/challenges/${c}/cancel`).set(tok(ADMIN));
    expect(r.status).toBe(409);
    expect(await balance(SARA)).toBe(b);
  });

  // ── Admin Refunds list ─────────────────────────────────────────
  it('GET /api/admin/refunds is admin-only', async () => {
    expect((await request(app).get('/api/admin/refunds')).status).toBe(401);
    expect((await request(app).get('/api/admin/refunds').set(tok(SARA))).status).toBe(403);
  });

  it('lists with totals, filters, search, paging and CSV', async () => {
    let r = await request(app).get('/api/admin/refunds').set(tok(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(5);
    expect(r.body.totals.points_refunded).toBeGreaterThan(0);
    expect(r.body.totals.card_aed).toBeGreaterThan(0);
    expect(r.body.shopify.note).toMatch(/Shopify admin/);
    const first = r.body.refunds[0];
    expect(first.member).toHaveProperty('email');
    expect(first.what).toHaveProperty('name');

    r = await request(app).get('/api/admin/refunds?method=points').set(tok(ADMIN));
    expect(r.body.refunds.length).toBeGreaterThan(0);
    expect(r.body.refunds.every((x) => x.points > 0 && (x.method === 'points' || x.method === 'mixed'))).toBe(true);

    r = await request(app).get('/api/admin/refunds?method=card&status=refunded').set(tok(ADMIN));
    expect(r.body.refunds.every((x) => x.method === 'card' && x.status === 'refunded')).toBe(true);

    r = await request(app).get('/api/admin/refunds?search=omar@x').set(tok(ADMIN));
    expect(r.body.refunds.length).toBeGreaterThan(0);
    expect(r.body.refunds.every((x) => x.member.email === 'omar@x.test')).toBe(true);

    r = await request(app).get('/api/admin/refunds?type=challenge_entry').set(tok(ADMIN));
    expect(r.body.refunds.every((x) => x.what.type === 'challenge_entry')).toBe(true);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    r = await request(app).get(`/api/admin/refunds?from=${today}&to=${today}`).set(tok(ADMIN));
    expect(r.body.total).toBeGreaterThan(0);
    r = await request(app).get('/api/admin/refunds?from=2001-01-01&to=2001-01-31').set(tok(ADMIN));
    expect(r.body.total).toBe(0);

    r = await request(app).get('/api/admin/refunds?limit=2&page=2').set(tok(ADMIN));
    expect(r.body.refunds).toHaveLength(2);
    expect(r.body.page).toBe(2);

    r = await request(app).get('/api/admin/refunds?format=csv&method=card').set(tok(ADMIN));
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text.split('\n')[0]).toMatch(/^date,member_name,member_email/);
    expect(r.text).toMatch(/pi_card_1/);
  });

  it('backfill brings earlier refunds into the log once (idempotent)', async () => {
    const bk = (await one(
      `INSERT INTO bookings (member_id, session_id, qr_code, qr_token, status, payment_method, points_paid, paid_at, refunded_at, refund_method, refunded_points)
       VALUES ($1,$2,'{}','legacy_tok','cancelled','points',100,NOW()-interval '9 days',NOW()-interval '8 days','points',100) RETURNING id`,
      [COACH, S_FAR])).id;
    await refunds.backfillLegacyRefunds();
    await refunds.backfillLegacyRefunds();
    const rows = await all(`SELECT method, points, status, reason, email_sent_at FROM refunds WHERE source_id=$1`, [bk]);
    expect(rows).toEqual([{ method: 'points', points: 100, status: 'refunded', reason: 'legacy', email_sent_at: null }]);
  });
});
