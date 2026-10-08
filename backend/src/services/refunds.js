/**
 * Refunds — "the money goes back the way it came in".
 *
 * Founder 2026-10-08: "Kindly ensure that when payments are done with
 * points the refund is done in points and not in money", plus a branded
 * refund confirmation email and a Refunds list in the admin panel.
 *
 * Every refund path goes through here:
 *   - member / admin cancel of a session booking   (routes/bookings.js)
 *   - an admin cancelling a whole session / series (routes/sessions.js)
 *   - coach 1-on-1 wallet cancels + card holds     (routes/coachSessions.js)
 *   - challenge cancelled → entry fees back        (routes/challenges.js)
 *   - "session filled while you were paying"       (services/billing.js)
 *   - admin "Retry refund"                         (routes/bookings.js)
 *   - refunds made by hand in the Stripe dashboard (charge.refunded webhook)
 *
 * Rules enforced:
 *   - points → points (ledger row + balance + FIFO `remaining`), wallet
 *     → wallet, card → card (Stripe refund on the original payment);
 *     a mixed points + wallet payment is split the same way it was paid.
 *   - one row per refund event in `refunds`, keyed by an idempotency
 *     key, so a retry, a double click or a webhook echo can't refund
 *     twice; card refunds claim their row BEFORE Stripe is called.
 *   - exactly one branded confirmation email per refund (email_sent_at
 *     is claimed atomically; released again if delivery fails).
 *
 * The table is created at boot (server.js _ensureBootSchema). Every
 * write here tolerates it (or a newer column) being missing — 42P01 /
 * 42703 — because a refund must never fail just because its log row
 * couldn't be written.
 */
const { query } = require('../db');

const STATUS = { REFUNDED: 'refunded', FAILED: 'failed', PENDING: 'pending', RELEASED: 'released' };

// How long a 'pending' card refund may sit before a retry is allowed to
// take it over (the process that claimed it most likely died mid-call).
const STALE_PENDING_MINUTES = 2;

// Points are worth 0.10 AED in the coach 1-on-1 wallet flow (10 pts =
// 1 AED, see routes/coachSessions.js POST /book).
const COACH_POINTS_PER_AED = 10;

function _isMissing(e) {
  return !!e && (e.code === '42P01' || e.code === '42703');
}

/**
 * Run one statement without poisoning the caller's transaction when the
 * refunds table / a newer column is missing. `client` = a transaction
 * client (statement wrapped in a SAVEPOINT) or null (plain pool query).
 * Returns the result, or null when the schema isn't there yet.
 */
async function _run(client, sql, params) {
  if (!client) {
    try { return await query(sql, params); }
    catch (e) { if (_isMissing(e)) return null; throw e; }
  }
  await client.query('SAVEPOINT atp_refunds');
  try {
    const r = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT atp_refunds');
    return r;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT atp_refunds');
    if (_isMissing(e)) return null;
    throw e;
  }
}

// ── Pure helpers (unit-tested) ──────────────────────────────────

/** Idempotency key for a refund of one payment of one session booking.
 *  The payment reference changes when a member rebooks and pays again,
 *  so each payment gets its own refund, but the same payment never two. */
function bookingRefundKey(b) {
  if (b.payment_method === 'stripe') {
    return `booking:${b.id}:card:${b.stripe_payment_intent_id || b.stripe_session_id || 'unknown'}`;
  }
  const paid = b.paid_at ? new Date(b.paid_at).getTime() : 'unknown';
  return `booking:${b.id}:points:${paid}`;
}

/**
 * Split a coach 1-on-1 refund back into points and wallet AED, in the
 * same proportion the member paid. A full refund returns exactly what
 * was paid (every point, every dirham). Partial refunds (the 50% window)
 * return the same share of each.
 */
function splitMixedRefund({ priceAed, pointsUsed, refundAed, pointsPerAed = COACH_POINTS_PER_AED }) {
  const price = Math.max(0, Number(priceAed) || 0);
  const pts = Math.max(0, parseInt(pointsUsed, 10) || 0);
  const refund = Math.max(0, Math.min(Number(refundAed) || 0, price));
  if (!refund || !price) return { points: 0, walletAed: 0 };
  // What the booking counted the points as (POST /book floors it).
  const pointsValueAed = Math.min(price, Math.floor(pts / pointsPerAed));
  const walletPaid = price - pointsValueAed;
  if (refund >= price) return { points: pts, walletAed: walletPaid };
  const share = refund / price;
  return { points: Math.round(pts * share), walletAed: Math.round(walletPaid * share) };
}

/** card | points | wallet | mixed — for a points + wallet split. */
function methodFor(points, walletAed) {
  if (points > 0 && walletAed > 0) return 'mixed';
  if (points > 0) return 'points';
  return 'wallet';
}

function describeSession(name) {
  return String(name || 'ATP session');
}

/** Was this paid before the 2026-10-07 points reset? (Flag only — the
 *  points the member paid are still refunded: it was their payment.) */
async function paidBeforePointsReset(paidAt) {
  if (!paidAt) return false;
  try {
    const cutoff = await require('./pointsReset').getResetCutoff();
    return !!cutoff && new Date(paidAt) < cutoff;
  } catch (e) { return false; }
}

// ── Ledger rows ─────────────────────────────────────────────────
const INSERT_COLS = [
  'idempotency_key', 'member_id', 'source_type', 'source_id', 'description', 'item_at',
  'method', 'amount', 'currency', 'points', 'status', 'reason', 'actor_id',
  'stripe_refund_id', 'stripe_payment_intent_id', 'card_brand', 'card_last4', 'error',
  'paid_before_points_reset', 'refunded_at',
];

/**
 * Insert a refund row. Returns { row, inserted } — when a row with the
 * same idempotency key (or Stripe refund id) already exists, that row
 * comes back with inserted=false. Returns null if the table is missing.
 */
async function recordRefund(client, f) {
  const v = {
    idempotency_key: f.key,
    member_id: f.member_id || null,
    source_type: f.source_type,
    source_id: f.source_id != null ? String(f.source_id) : null,
    description: f.description ? String(f.description).slice(0, 300) : null,
    item_at: f.item_at || null,
    method: f.method,
    amount: f.amount != null ? Number(f.amount) : null,
    currency: f.amount != null ? String(f.currency || 'AED').toUpperCase() : null,
    points: f.points != null ? parseInt(f.points, 10) : null,
    status: f.status,
    reason: f.reason || null,
    actor_id: f.actor_id || null,
    stripe_refund_id: f.stripe_refund_id || null,
    stripe_payment_intent_id: f.stripe_payment_intent_id || null,
    card_brand: f.card_brand || null,
    card_last4: f.card_last4 || null,
    error: f.error ? String(f.error).slice(0, 500) : null,
    paid_before_points_reset: !!f.paid_before_points_reset,
    refunded_at: f.status === STATUS.REFUNDED ? (f.refunded_at || new Date()) : null,
  };
  const params = INSERT_COLS.map((c) => v[c]);
  const r = await _run(client,
    `INSERT INTO refunds (${INSERT_COLS.join(', ')})
     VALUES (${INSERT_COLS.map((_, i) => '$' + (i + 1)).join(', ')})
     ON CONFLICT DO NOTHING
     RETURNING *`,
    params);
  if (!r) return null;
  if (r.rows.length) return { row: r.rows[0], inserted: true };
  const ex = await _run(client,
    `SELECT * FROM refunds WHERE idempotency_key=$1
         OR ($2::text IS NOT NULL AND stripe_refund_id=$2::text)
      ORDER BY created_at LIMIT 1`,
    [v.idempotency_key, v.stripe_refund_id]);
  return ex && ex.rows.length ? { row: ex.rows[0], inserted: false } : null;
}

const UPDATABLE = new Set([
  'status', 'amount', 'currency', 'points', 'stripe_refund_id', 'stripe_payment_intent_id',
  'card_brand', 'card_last4', 'error', 'refunded_at', 'attempts',
]);
async function updateRefund(client, id, patch) {
  if (!id) return null;
  const sets = [];
  const params = [id];
  for (const [k, val] of Object.entries(patch || {})) {
    if (!UPDATABLE.has(k)) continue;
    params.push(val);
    sets.push(`${k}=$${params.length}`);
  }
  if (!sets.length) return null;
  const r = await _run(client,
    `UPDATE refunds SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$1 RETURNING *`, params);
  return r && r.rows[0] ? r.rows[0] : null;
}

// ── Money / points movements (inside the caller's transaction) ──

/**
 * Points back to the member: a positive ledger row + balance up. The
 * row is LIVE for FIFO (remaining = points, 12-month expiry, same as
 * any earned points — services/points.js awardPoints), so later spends
 * and the expiry job see it. Caller holds the transaction.
 */
async function creditPoints(client, memberId, points, { reason, referenceId = null, description }) {
  const pts = parseInt(points, 10) || 0;
  if (pts <= 0) return null;
  const { rows } = await client.query(
    'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE', [memberId]
  );
  const newBalance = ((rows[0] && rows[0].points_balance) || 0) + pts;
  const full = await _run(client,
    `INSERT INTO points_ledger
       (member_id, amount, balance, reason, reference_id, description, expires_at, remaining)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '365 days', $2)`,
    [memberId, pts, newBalance, reason, referenceId, description]);
  if (!full) {
    // Pre-FIFO schema (no `remaining` column).
    await client.query(
      `INSERT INTO points_ledger (member_id, amount, balance, reason, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [memberId, pts, newBalance, reason, referenceId, description]
    );
  }
  await client.query('UPDATE members SET points_balance=$1 WHERE id=$2', [newBalance, memberId]);
  return newBalance;
}

/** AED back into the member's ATP wallet (+ a 'refund' wallet txn). */
async function creditWallet(client, memberId, amountAed, { refType = null, refId = null, description }) {
  const amt = Math.round(Number(amountAed) || 0);
  if (amt <= 0) return null;
  await client.query(
    `INSERT INTO member_wallet (member_id) VALUES ($1) ON CONFLICT (member_id) DO NOTHING`, [memberId]
  );
  const { rows } = await client.query(
    'SELECT balance_aed FROM member_wallet WHERE member_id=$1 FOR UPDATE', [memberId]
  );
  const after = ((rows[0] && rows[0].balance_aed) || 0) + amt;
  await client.query(
    'UPDATE member_wallet SET balance_aed=$1, updated_at=NOW() WHERE member_id=$2', [after, memberId]
  );
  await client.query(
    `INSERT INTO member_wallet_transactions
       (member_id, amount_aed, balance_after, txn_type, reference_type, reference_id, description)
     VALUES ($1, $2, $3, 'refund', $4, $5, $6)`,
    [memberId, amt, after, refType, refId, description]
  );
  return after;
}

/** Stamp a session booking as refunded (columns analytics + the legacy
 *  maintenance view read). Older schemas only have refunded_at. */
async function markBookingRefunded(client, bookingId, { method, points = null, amount = null, currency = null, stripeRefundId = null }) {
  const full = await _run(client,
    `UPDATE bookings
        SET refunded_at=NOW(),
            refund_method=$2,
            refunded_points=$3,
            refunded_amount=$4,
            refunded_currency=$5,
            stripe_refund_id=COALESCE($6, stripe_refund_id)
      WHERE id=$1`,
    [bookingId, method, points, amount, currency, stripeRefundId]);
  if (!full) await _run(client, 'UPDATE bookings SET refunded_at=NOW() WHERE id=$1', [bookingId]);
}

/**
 * A booking is being (re)booked from scratch: forget the previous
 * payment cycle's payment + refund stamps, so a rebook that is paid and
 * cancelled again gets its own refund (the old refunded_at used to block
 * it) and a forfeited old payment can't be refunded through a free
 * rebooking. History stays in the refunds table.
 */
async function clearBookingPayment(client, bookingId) {
  await _run(client,
    `UPDATE bookings
        SET payment_method=NULL, payment_amount=NULL, payment_currency=NULL,
            points_paid=NULL, stripe_session_id=NULL, stripe_payment_intent_id=NULL,
            paid_at=NULL, refunded_at=NULL, refund_method=NULL, refunded_points=NULL,
            refunded_amount=NULL, refunded_currency=NULL, stripe_refund_id=NULL
      WHERE id=$1`,
    [bookingId]);
}

// ── Card refunds for session bookings ───────────────────────────

/**
 * Claim the right to (re)issue the card refund for a cancelled booking
 * (admin "Retry refund"). Reuses the booking's open row — 'failed', or
 * 'pending' but stale — rather than adding a second one. Returns { row }
 * (row null when the table is missing: proceed untracked), { already }
 * when it has been refunded, or { busy } when another request is issuing
 * it right now.
 */
async function claimBookingCardRefund(booking, { reason, actorId = null } = {}) {
  const done = await _run(null,
    `SELECT * FROM refunds
      WHERE source_type='session_booking' AND source_id=$1 AND method='card' AND status='refunded'
        AND (idempotency_key=$2 OR stripe_payment_intent_id=$3)
      ORDER BY created_at DESC LIMIT 1`,
    [String(booking.id), bookingRefundKey(booking), booking.stripe_payment_intent_id || '']);
  if (!done) return { row: null };
  if (done.rows.length) return { already: done.rows[0] };

  // The status test sits in the OUTER WHERE too, so two concurrent
  // retries can't both take the row: the second one re-checks it after
  // the first commits, sees a fresh 'pending', and backs off.
  const open = await _run(null,
    `UPDATE refunds
        SET status='pending', error=NULL, attempts=COALESCE(attempts,1)+1, updated_at=NOW()
      WHERE id = (SELECT id FROM refunds
                   WHERE source_type='session_booking' AND source_id=$1 AND method='card'
                     AND stripe_refund_id IS NULL AND status IN ('failed','pending')
                   ORDER BY created_at DESC LIMIT 1)
        AND (status='failed'
             OR (status='pending' AND updated_at < NOW() - INTERVAL '${STALE_PENDING_MINUTES} minutes'))
      RETURNING *`,
    [String(booking.id)]);
  if (open && open.rows.length) return { row: open.rows[0] };

  const rec = await recordRefund(null, {
    key: bookingRefundKey(booking),
    member_id: booking.member_id,
    source_type: 'session_booking',
    source_id: booking.id,
    description: describeSession(booking.session_name),
    item_at: booking.scheduled_at || null,
    method: 'card',
    amount: booking.payment_amount != null ? Number(booking.payment_amount) : null,
    currency: booking.payment_currency || 'AED',
    status: STATUS.PENDING,
    reason: reason || 'admin_retry',
    actor_id: actorId,
    stripe_payment_intent_id: booking.stripe_payment_intent_id || null,
  });
  if (!rec) return { row: null };
  if (rec.inserted) return { row: rec.row };
  if (rec.row.status === STATUS.REFUNDED) return { already: rec.row };
  return { busy: true };
}

/**
 * Issue the Stripe refund for a booking whose ledger row was already
 * claimed ('pending'), then record the outcome on the row + the booking.
 * Never throws: returns { ok, amount, currency, refund } or { ok:false, error, code }.
 */
async function issueBookingCardRefund(booking, { refundRow = null } = {}) {
  const billing = require('./billing');
  let stripeRefund;
  try {
    stripeRefund = await billing.refundStripeBooking(booking, {
      atpRefundId: refundRow ? refundRow.id : null,
      // A new key per attempt: Stripe caches the result of a key for
      // 24h, so reusing one would replay an old failure on retry.
      idempotencyKey: refundRow ? `atp-refund-${refundRow.id}-${refundRow.attempts || 1}` : undefined,
    });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn('[refunds] Stripe refund failed for booking', booking.id, msg);
    if (refundRow) await updateRefund(null, refundRow.id, { status: STATUS.FAILED, error: msg.slice(0, 500) }).catch(() => {});
    return { ok: false, error: msg, code: e && e.code };
  }
  if (!stripeRefund || !stripeRefund.id) {
    if (refundRow) await updateRefund(null, refundRow.id, { status: STATUS.FAILED, error: 'Stripe refund did not return an id.' }).catch(() => {});
    return { ok: false, error: 'Stripe refund did not return an id.' };
  }
  const amount = stripeRefund.amount != null ? Number(stripeRefund.amount) / 100 : Number(booking.payment_amount || 0);
  const currency = String(stripeRefund.currency || booking.payment_currency || 'AED').toUpperCase();
  await markBookingRefunded(null, booking.id, {
    method: 'stripe', amount, currency, stripeRefundId: stripeRefund.id,
  }).catch((e) => console.warn('[refunds] booking stamp failed', booking.id, e.message));
  let row = refundRow;
  if (refundRow) {
    row = await updateRefund(null, refundRow.id, {
      status: STATUS.REFUNDED,
      stripe_refund_id: stripeRefund.id,
      stripe_payment_intent_id: (typeof stripeRefund.payment_intent === 'string' && stripeRefund.payment_intent)
        || booking.stripe_payment_intent_id || refundRow.stripe_payment_intent_id || null,
      amount, currency, error: null, refunded_at: new Date(),
    }).catch(() => refundRow) || refundRow;
  }
  return { ok: true, amount, currency, refund: stripeRefund, row };
}

// ── Confirmation email (exactly once) ───────────────────────────

/**
 * Send the branded refund email for one refund row — at most once. The
 * row's email_sent_at is claimed atomically first; if delivery then
 * fails the claim is released (and the reason kept in email_error) so
 * the admin list shows "not sent" rather than a false "sent".
 * `extra` adds display-only fields (points_balance, note).
 */
async function notifyRefund(refundId, extra = {}) {
  if (!refundId) return { sent: false, reason: 'no_row' };
  const claim = await _run(null,
    `UPDATE refunds SET email_sent_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND email_sent_at IS NULL AND status='refunded'
      RETURNING *`,
    [refundId]);
  const row = claim && claim.rows[0];
  if (!row) return { sent: false, reason: 'already_sent_or_not_refunded' };
  let result;
  try {
    const { rows: m } = await query('SELECT id, first_name, email FROM members WHERE id=$1', [row.member_id]);
    const emailService = require('./email');
    result = await emailService.sendRefundConfirmation(m[0] || null, { ...row, ...extra });
  } catch (e) {
    result = { ok: false, reason: e.message };
  }
  if (!result || !result.ok) {
    const why = String((result && (result.reason || result.code)) || 'send failed').slice(0, 300);
    await _run(null, 'UPDATE refunds SET email_sent_at=NULL, email_error=$2 WHERE id=$1', [refundId, why]).catch(() => {});
    return { sent: false, reason: why };
  }
  await _run(null, 'UPDATE refunds SET email_error=NULL WHERE id=$1', [refundId]).catch(() => {});
  return { sent: true };
}

/** Fire-and-forget wrapper: never blocks or fails the refund path. */
function notifyRefundSoon(refundId, extra) {
  if (!refundId) return Promise.resolve({ sent: false });
  return Promise.resolve()
    .then(() => notifyRefund(refundId, extra))
    .catch((e) => { console.warn('[refunds] confirmation email failed', refundId, e.message); return { sent: false }; });
}

// ── Stripe dashboard refunds (charge.refunded webhook) ──────────

/** What ATP thing a Stripe charge paid for. */
async function _findPaymentTarget(pi, charge, refundList) {
  // 1. Session booking (by PaymentIntent, or the booking id our own
  //    refunds carry in their metadata).
  const metaBookingIds = (refundList || [])
    .map((r) => r && r.metadata && r.metadata.booking_id).filter(Boolean);
  const bk = await _run(null,
    `SELECT b.*, s.name AS session_name, s.scheduled_at
       FROM bookings b JOIN sessions s ON s.id = b.session_id
      WHERE ($1::text IS NOT NULL AND b.stripe_payment_intent_id = $1::text)
         OR b.id::text = ANY($2::text[])
      ORDER BY (b.stripe_payment_intent_id = $1::text) DESC NULLS LAST
      LIMIT 1`,
    [pi || null, metaBookingIds]);
  if (bk && bk.rows.length) {
    const b = bk.rows[0];
    return { source_type: 'session_booking', source_id: b.id, member_id: b.member_id,
             description: describeSession(b.session_name), item_at: b.scheduled_at, booking: b };
  }
  // 2. Coach 1-on-1 card booking.
  if (pi) {
    const cb = await _run(null,
      `SELECT cb.id, cb.payer_id, cb.scheduled_at, o.title AS offering_title,
              c.first_name AS coach_first, c.last_name AS coach_last
         FROM coach_session_bookings cb
         LEFT JOIN coach_offerings o ON o.id = cb.offering_id
         LEFT JOIN members c ON c.id = cb.coach_id
        WHERE cb.payment_intent_id = $1 LIMIT 1`,
      [pi]);
    if (cb && cb.rows.length) {
      const r = cb.rows[0];
      const coach = [r.coach_first, r.coach_last].filter(Boolean).join(' ');
      return { source_type: 'coach_session', source_id: r.id, member_id: r.payer_id,
               description: (r.offering_title || '1-on-1 session') + (coach ? ' with ' + coach : ''),
               item_at: r.scheduled_at };
    }
  }
  // 3. Membership (subscription invoice) or any other charge on a known customer.
  if (charge && charge.customer) {
    const m = await _run(null, 'SELECT id FROM members WHERE stripe_customer_id=$1 LIMIT 1', [charge.customer]);
    if (m && m.rows.length) {
      if (charge.invoice) {
        return { source_type: 'subscription', source_id: String(charge.invoice), member_id: m.rows[0].id,
                 description: 'ATP membership', item_at: null };
      }
      return { source_type: 'stripe_payment', source_id: charge.id, member_id: m.rows[0].id,
               description: charge.description || 'Card payment to ATP', item_at: null };
    }
  }
  return null;
}

async function _recordStripeRefund(re, target, ctx) {
  const amount = re.amount != null ? Number(re.amount) / 100 : null;
  const currency = String(re.currency || ctx.currency || 'aed').toUpperCase();
  const brand = ctx.card.brand || null;
  const last4 = ctx.card.last4 || null;
  const refundedAt = re.created ? new Date(re.created * 1000) : new Date();

  // a) Our own refund — its ledger row was claimed before Stripe was
  //    called. Complete it (it may still be 'pending', or 'failed' if
  //    our call timed out after Stripe had already done it); never a
  //    second row, and the email claim keeps it to one email.
  const ours = re.metadata && re.metadata.atp_refund_id;
  if (ours) {
    const r = await _run(null,
      `UPDATE refunds
          SET stripe_refund_id = COALESCE(stripe_refund_id, $2),
              card_brand = COALESCE(card_brand, $3),
              card_last4 = COALESCE(card_last4, $4),
              amount = COALESCE(amount, $5),
              error = CASE WHEN status IN ('pending','failed') THEN NULL ELSE error END,
              refunded_at = COALESCE(refunded_at, $6),
              status = CASE WHEN status IN ('pending','failed') THEN 'refunded' ELSE status END,
              updated_at = NOW()
        WHERE id::text = $1
        RETURNING *`,
      [String(ours), re.id, brand, last4, amount, refundedAt]);
    if (r && r.rows.length) { notifyRefundSoon(r.rows[0].id); return { kind: 'ours', row: r.rows[0] }; }
  }

  // b) Seen before (webhook redelivery / a later partial refund on the
  //    same charge re-lists this one) — just top up the card details.
  const seen = await _run(null,
    `UPDATE refunds SET card_brand = COALESCE(card_brand, $2), card_last4 = COALESCE(card_last4, $3), updated_at = NOW()
      WHERE stripe_refund_id = $1 RETURNING *`,
    [re.id, brand, last4]);
  if (seen && seen.rows.length) return { kind: 'seen', row: seen.rows[0] };

  // c) Issued by the code before the refunds log existed (or with the
  //    table missing) — the booking itself carries the refund id.
  if (target.booking && target.booking.stripe_refund_id === re.id) return { kind: 'legacy' };

  // d) A refund made outside ATP (Stripe dashboard). If our automatic
  //    refund for this payment had failed (or never finished), the admin
  //    just did it by hand: complete that row instead of adding another.
  const open = await _run(null,
    `UPDATE refunds
        SET status='refunded', stripe_refund_id=$3, amount=COALESCE($4, amount), currency=$5,
            card_brand=COALESCE(card_brand,$6), card_last4=COALESCE(card_last4,$7),
            error=NULL, refunded_at=$8, updated_at=NOW()
      WHERE id = (SELECT id FROM refunds
                   WHERE source_type=$1 AND source_id=$2 AND method='card'
                     AND status IN ('failed','pending') AND stripe_refund_id IS NULL
                   ORDER BY created_at DESC LIMIT 1)
      RETURNING *`,
    [target.source_type, String(target.source_id), re.id, amount, currency, brand, last4, refundedAt]);
  if (open && open.rows.length) { notifyRefundSoon(open.rows[0].id); return { kind: 'completed', row: open.rows[0] }; }

  const rec = await recordRefund(null, {
    key: `stripe_refund:${re.id}`,
    member_id: target.member_id,
    source_type: target.source_type,
    source_id: target.source_id,
    description: target.description,
    item_at: target.item_at,
    method: 'card',
    amount, currency,
    status: STATUS.REFUNDED,
    reason: 'stripe_dashboard',
    stripe_refund_id: re.id,
    stripe_payment_intent_id: ctx.pi || null,
    card_brand: brand, card_last4: last4,
    refunded_at: refundedAt,
  });
  if (rec && rec.inserted) notifyRefundSoon(rec.row.id);
  return { kind: 'dashboard', row: rec && rec.row };
}

/**
 * charge.refunded → record every refund on the charge that ATP doesn't
 * know about yet (made in the Stripe dashboard), email the member once,
 * and stamp a fully refunded session booking so a later cancel can't
 * refund it a second time.
 */
async function handleChargeRefunded(charge) {
  if (!charge || !charge.id) return { handled: false };
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent
    : (charge.payment_intent && charge.payment_intent.id) || null;
  const card = (charge.payment_method_details && charge.payment_method_details.card) || {};
  const currency = String(charge.currency || 'aed').toUpperCase();

  // charge.refunds is only in the payload on old API versions; newer
  // ones need one read call. Never a write.
  let list = charge.refunds && Array.isArray(charge.refunds.data) ? charge.refunds.data : null;
  if (!list) {
    try {
      const billing = require('./billing');
      list = (await billing.stripe().refunds.list({ charge: charge.id, limit: 100 })).data || [];
    } catch (e) {
      console.warn('[refunds] could not list refunds for', charge.id, e.message);
      list = null;
    }
  }

  const target = await _findPaymentTarget(pi, charge, list);
  if (!target) {
    console.log('[refunds] charge.refunded for a payment ATP does not know:', charge.id);
    return { handled: false };
  }

  const results = [];
  if (list) {
    for (const re of list) {
      if (!re || !re.id || re.status === 'failed' || re.status === 'canceled') continue;
      results.push(await _recordStripeRefund(re, target, { pi, card, currency }));
    }
  } else {
    // No refund ids available: record whatever amount ATP hasn't seen yet.
    const known = await _run(null,
      `SELECT COALESCE(SUM(amount),0) AS total FROM refunds
        WHERE source_type=$1 AND source_id=$2 AND method='card' AND status IN ('refunded','pending')`,
      [target.source_type, String(target.source_id)]);
    const seen = known ? Number(known.rows[0].total) : 0;
    const delta = Math.round(((Number(charge.amount_refunded || 0) / 100) - seen) * 100) / 100;
    if (delta > 0) {
      const rec = await recordRefund(null, {
        key: `stripe_charge:${charge.id}:${charge.amount_refunded}`,
        member_id: target.member_id, source_type: target.source_type, source_id: target.source_id,
        description: target.description, item_at: target.item_at, method: 'card',
        amount: delta, currency, status: STATUS.REFUNDED, reason: 'stripe_dashboard',
        stripe_payment_intent_id: pi, card_brand: card.brand || null, card_last4: card.last4 || null,
      });
      if (rec && rec.inserted) notifyRefundSoon(rec.row.id);
      results.push({ kind: 'dashboard_amount', row: rec && rec.row });
    }
  }

  // Fully refunded session booking → stamp it, so cancelling it later
  // can't send a second refund for money that's already gone back.
  if (target.source_type === 'session_booking' && charge.refunded) {
    const last = list && list.find((r) => r && r.status !== 'failed' && r.status !== 'canceled');
    await _run(null,
      `UPDATE bookings
          SET refunded_at = COALESCE(refunded_at, NOW()),
              refund_method = COALESCE(refund_method, 'stripe'),
              refunded_amount = COALESCE(refunded_amount, $2),
              refunded_currency = COALESCE(refunded_currency, $3),
              stripe_refund_id = COALESCE(stripe_refund_id, $4)
        WHERE id = $1`,
      [target.source_id, Number(charge.amount_refunded || 0) / 100, currency, last ? last.id : null]);
  }
  return { handled: true, target: target.source_type, results };
}

// ── Coach card holds (not refunds: nothing was charged) ─────────

/** Log a released manual-capture hold so the admin list shows it.
 *  No email — the member was never charged (they get the in-app note). */
async function recordReleasedHold(booking, { reason }) {
  return recordRefund(null, {
    key: `coach:${booking.id}:hold`,
    member_id: booking.payer_id || booking.member_id,
    source_type: 'coach_session',
    source_id: booking.id,
    description: (booking.offering_title || '1-on-1 session'),
    item_at: booking.scheduled_at || null,
    method: 'card',
    amount: booking.price_paid_aed != null ? Number(booking.price_paid_aed) : null,
    currency: 'AED',
    status: STATUS.RELEASED,
    reason,
    stripe_payment_intent_id: booking.payment_intent_id || null,
  }).catch((e) => { console.warn('[refunds] hold log failed', booking.id, e.message); return null; });
}

// ── Boot: schema + one-time history ─────────────────────────────

async function ensureSchema() {
  await query(`CREATE TABLE IF NOT EXISTS refunds (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key           TEXT UNIQUE,
    member_id                 UUID REFERENCES members(id) ON DELETE SET NULL,
    source_type               VARCHAR(30) NOT NULL,
    source_id                 TEXT,
    description               TEXT,
    item_at                   TIMESTAMPTZ,
    method                    VARCHAR(20) NOT NULL,
    amount                    NUMERIC(10,2),
    currency                  VARCHAR(8),
    points                    INT,
    status                    VARCHAR(20) NOT NULL,
    reason                    VARCHAR(40),
    actor_id                  UUID,
    stripe_refund_id          TEXT,
    stripe_payment_intent_id  TEXT,
    card_brand                VARCHAR(30),
    card_last4                VARCHAR(4),
    error                     TEXT,
    attempts                  INT NOT NULL DEFAULT 1,
    paid_before_points_reset  BOOLEAN NOT NULL DEFAULT false,
    email_sent_at             TIMESTAMPTZ,
    email_error               TEXT,
    refunded_at               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_refunds_stripe_refund_id
    ON refunds(stripe_refund_id) WHERE stripe_refund_id IS NOT NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refunds_created ON refunds(created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refunds_member ON refunds(member_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_refunds_source ON refunds(source_type, source_id)`);
}

/**
 * Bring refunds made before this log existed into it, so the admin list
 * is complete from day one. Idempotent (fixed keys + NOT EXISTS per
 * source), never emails, never moves money. Each source is optional.
 */
async function backfillLegacyRefunds() {
  const steps = [
    // Session bookings refunded by the old code (points or card).
    `INSERT INTO refunds (idempotency_key, member_id, source_type, source_id, description, item_at,
                          method, amount, currency, points, status, reason, stripe_refund_id,
                          stripe_payment_intent_id, refunded_at, created_at)
     SELECT 'legacy:booking:' || b.id, b.member_id, 'session_booking', b.id::text, s.name, s.scheduled_at,
            CASE WHEN COALESCE(b.refund_method, b.payment_method) = 'points' THEN 'points' ELSE 'card' END,
            CASE WHEN COALESCE(b.refund_method, b.payment_method) = 'points' THEN NULL
                 ELSE COALESCE(b.refunded_amount, b.payment_amount) END,
            CASE WHEN COALESCE(b.refund_method, b.payment_method) = 'points' THEN NULL
                 ELSE COALESCE(b.refunded_currency, b.payment_currency, 'AED') END,
            CASE WHEN COALESCE(b.refund_method, b.payment_method) = 'points'
                 THEN COALESCE(b.refunded_points, b.points_paid) END,
            'refunded', 'legacy', b.stripe_refund_id, b.stripe_payment_intent_id,
            b.refunded_at, b.refunded_at
       FROM bookings b JOIN sessions s ON s.id = b.session_id
      WHERE b.refunded_at IS NOT NULL
        AND COALESCE(b.refund_method, b.payment_method) IN ('points','stripe')
        AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.source_type='session_booking' AND r.source_id=b.id::text)
     ON CONFLICT DO NOTHING`,
    // Card bookings that should have been refunded (cancelled more than
    // 12h ahead, or the session itself was cancelled) but never were —
    // a failed Stripe call under the old code. Shown as 'failed' so the
    // admin can retry; inside-12h cancels were forfeits, not failures.
    `INSERT INTO refunds (idempotency_key, member_id, source_type, source_id, description, item_at,
                          method, amount, currency, status, reason, error, stripe_payment_intent_id, created_at)
     SELECT 'legacy:booking-failed:' || b.id, b.member_id, 'session_booking', b.id::text, s.name, s.scheduled_at,
            'card', b.payment_amount, COALESCE(b.payment_currency, 'AED'), 'failed', 'legacy',
            'No refund was recorded when this booking was cancelled (before the refunds log existed). Check Stripe before retrying.',
            b.stripe_payment_intent_id, COALESCE(b.cancelled_at, NOW())
       FROM bookings b JOIN sessions s ON s.id = b.session_id
      WHERE b.status='cancelled' AND b.payment_method='stripe' AND COALESCE(b.payment_amount,0) > 0
        AND b.refunded_at IS NULL AND b.stripe_refund_id IS NULL AND b.paid_at IS NOT NULL
        AND (s.status='cancelled' OR b.cancelled_at <= s.scheduled_at - INTERVAL '12 hours')
        AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.source_type='session_booking' AND r.source_id=b.id::text)
     ON CONFLICT DO NOTHING`,
    // Challenge entry fees refunded on cancel.
    `INSERT INTO refunds (idempotency_key, member_id, source_type, source_id, description,
                          method, points, status, reason, refunded_at, created_at)
     SELECT 'legacy:challenge:' || p.id, p.member_id, 'challenge_entry', p.id::text,
            'Challenge entry: ' || c.title, 'points', p.entry_paid_points, 'refunded', 'legacy',
            p.refunded_at, p.refunded_at
       FROM challenge_participants p JOIN challenges c ON c.id = p.challenge_id
      WHERE p.refunded_at IS NOT NULL AND p.entry_paid_points > 0
        AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.source_type='challenge_entry' AND r.source_id=p.id::text)
     ON CONFLICT DO NOTHING`,
    // Coach 1-on-1 wallet bookings refunded on cancel (old split: points
    // first, then AED — reconstructed the same way the old code did it).
    `INSERT INTO refunds (idempotency_key, member_id, source_type, source_id, description, item_at,
                          method, amount, currency, points, status, reason, refunded_at, created_at)
     SELECT 'legacy:coach:' || x.id, x.payer_id, 'coach_session', x.id::text, x.title, x.scheduled_at,
            CASE WHEN x.pts > 0 AND x.aed > 0 THEN 'mixed' WHEN x.pts > 0 THEN 'points' ELSE 'wallet' END,
            NULLIF(x.aed, 0), 'AED', NULLIF(x.pts, 0), 'refunded', 'legacy', x.cancelled_at, COALESCE(x.cancelled_at, NOW())
       FROM (SELECT cb.id, cb.payer_id, cb.scheduled_at, cb.cancelled_at,
                    COALESCE(o.title, '1-on-1 session') AS title,
                    ROUND(LEAST(cb.points_used * 0.1, cb.refund_aed) * 10)::int AS pts,
                    (cb.refund_aed - ROUND(LEAST(cb.points_used * 0.1, cb.refund_aed)))::int AS aed
               FROM coach_session_bookings cb
               LEFT JOIN coach_offerings o ON o.id = cb.offering_id
              WHERE cb.refund_aed > 0 AND COALESCE(cb.payment_method,'wallet') <> 'card') x
      WHERE NOT EXISTS (SELECT 1 FROM refunds r WHERE r.source_type='coach_session' AND r.source_id=x.id::text)
     ON CONFLICT DO NOTHING`,
    // Coach card holds that were released (declined / expired / cancelled).
    `INSERT INTO refunds (idempotency_key, member_id, source_type, source_id, description, item_at,
                          method, amount, currency, status, reason, stripe_payment_intent_id, created_at)
     SELECT 'coach:' || cb.id || ':hold', cb.payer_id, 'coach_session', cb.id::text,
            COALESCE(o.title, '1-on-1 session'), cb.scheduled_at, 'card', cb.price_paid_aed, 'AED',
            'released', 'legacy', cb.payment_intent_id, COALESCE(cb.cancelled_at, cb.updated_at, NOW())
       FROM coach_session_bookings cb
       LEFT JOIN coach_offerings o ON o.id = cb.offering_id
      WHERE cb.payment_method='card' AND cb.payment_status='canceled'
        AND cb.status IN ('declined','expired','cancelled_by_member','cancelled_by_coach','payment_failed')
     ON CONFLICT DO NOTHING`,
  ];
  let inserted = 0;
  for (const sql of steps) {
    try {
      const r = await query(sql);
      inserted += r.rowCount || 0;
    } catch (e) {
      if (!_isMissing(e)) console.warn('[refunds] backfill step skipped:', e.message);
    }
  }
  return { inserted };
}

module.exports = {
  STATUS,
  bookingRefundKey,
  splitMixedRefund,
  methodFor,
  describeSession,
  paidBeforePointsReset,
  recordRefund,
  updateRefund,
  creditPoints,
  creditWallet,
  markBookingRefunded,
  clearBookingPayment,
  claimBookingCardRefund,
  issueBookingCardRefund,
  notifyRefund,
  notifyRefundSoon,
  handleChargeRefunded,
  recordReleasedHold,
  ensureSchema,
  backfillLegacyRefunds,
};
