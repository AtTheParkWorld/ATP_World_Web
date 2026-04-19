const { query, transaction } = require('../db');
const emailService = require('./email');

// ── AWARD POINTS ──────────────────────────────────────────────
async function awardPoints(memberId, amount, reason, description, referenceId = null) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
      [memberId]
    );
    if (!rows.length) throw new Error('Member not found');

    const newBalance = rows[0].points_balance + amount;
    const expiresAt  = amount > 0
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      : null;

    await client.query(
      `INSERT INTO points_ledger
        (member_id, amount, balance, reason, reference_id, description, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [memberId, amount, newBalance, reason, referenceId, description, expiresAt]
    );
    await client.query(
      'UPDATE members SET points_balance=$1, last_active_at=NOW() WHERE id=$2',
      [newBalance, memberId]
    );

    // Create in-app notification
    if (amount > 0) {
      await client.query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         VALUES ($1,'points_earned','You earned ${amount} ATP points!',
         $2, $3)`,
        [memberId, description, JSON.stringify({ amount, reason, new_balance: newBalance })]
      );
    }

    return newBalance;
  });
}

// ── PROCESS ANNIVERSARIES ─────────────────────────────────────
// Called daily by cron
async function processAnniversaries() {
  const { rows: config } = await query(
    "SELECT points FROM points_config WHERE action='anniversary'"
  );
  const pts = config[0]?.points || 200;

  // Find members whose anniversary is today (joined same month+day, any year)
  const { rows: members } = await query(
    `SELECT id, first_name, email, joined_at
     FROM members
     WHERE EXTRACT(MONTH FROM joined_at) = EXTRACT(MONTH FROM NOW())
       AND EXTRACT(DAY FROM joined_at) = EXTRACT(DAY FROM NOW())
       AND is_banned = false
       AND joined_at < NOW() - INTERVAL '364 days'`
  );

  let processed = 0;
  for (const member of members) {
    // Check not already awarded this year
    const { rows: existing } = await query(
      `SELECT id FROM points_ledger
       WHERE member_id=$1 AND reason='anniversary'
         AND created_at >= DATE_TRUNC('year', NOW())`,
      [member.id]
    );
    if (existing.length) continue;

    const years = Math.floor(
      (Date.now() - new Date(member.joined_at)) / (365.25 * 24 * 60 * 60 * 1000)
    );
    const desc = `🎉 ${years}-year ATP anniversary bonus`;

    await awardPoints(member.id, pts, 'anniversary', desc);
    processed++;
  }
  console.log(`Anniversaries: processed ${processed} members`);
  return processed;
}

// ── PROCESS REFERRAL POINTS ───────────────────────────────────
// Called when a referred member completes their first check-in
async function processReferralPoints(referredMemberId) {
  const { rows: referral } = await query(
    `SELECT r.id, r.referrer_id, r.points_awarded
     FROM referrals r
     WHERE r.referred_id=$1 AND r.points_awarded=false`,
    [referredMemberId]
  );
  if (!referral.length) return;

  const { rows: config } = await query(
    "SELECT points FROM points_config WHERE action='referral'"
  );
  const pts = config[0]?.points || 50;

  await transaction(async (client) => {
    await awardPoints(
      referral[0].referrer_id, pts, 'referral',
      'Referral bonus — your friend completed their first check-in!',
      referral[0].id
    );
    await client.query(
      'UPDATE referrals SET points_awarded=true, points_awarded_at=NOW() WHERE id=$1',
      [referral[0].id]
    );
  });
}

// ── PROCESS EXPIRING POINTS ───────────────────────────────────
async function processExpiringPoints() {
  // Warn members 30 days before
  const { rows: warn } = await query(
    `SELECT member_id,
            SUM(amount) AS expiring_pts,
            MIN(expires_at) AS earliest_expiry
     FROM points_ledger
     WHERE expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'
       AND expired_at IS NULL
       AND amount > 0
     GROUP BY member_id`
  );

  for (const row of warn) {
    const { rows: m } = await query(
      'SELECT email, first_name FROM members WHERE id=$1',
      [row.member_id]
    );
    if (m.length) {
      await emailService.sendPointsExpiryWarning(
        m[0], parseInt(row.expiring_pts), row.earliest_expiry
      );
    }
  }

  // Expire points past their date
  const { rows: expired } = await query(
    `SELECT member_id, SUM(amount) AS total
     FROM points_ledger
     WHERE expires_at < NOW() AND expired_at IS NULL AND amount > 0
     GROUP BY member_id`
  );

  for (const row of expired) {
    await transaction(async (client) => {
      const { rows: m } = await client.query(
        'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE',
        [row.member_id]
      );
      const expireAmt = Math.min(parseInt(row.total), m[0]?.points_balance || 0);
      if (expireAmt <= 0) return;

      const newBal = m[0].points_balance - expireAmt;
      await client.query(
        `INSERT INTO points_ledger (member_id,amount,balance,reason,description)
         VALUES ($1,$2,$3,'expiry','Points expired — not used within 12 months')`,
        [row.member_id, -expireAmt, newBal]
      );
      await client.query(
        'UPDATE members SET points_balance=$1 WHERE id=$2',
        [newBal, row.member_id]
      );
      await client.query(
        `UPDATE points_ledger SET expired_at=NOW()
         WHERE member_id=$1 AND expires_at<NOW() AND expired_at IS NULL AND amount>0`,
        [row.member_id]
      );
    });
  }

  console.log(`Points expiry: warned ${warn.length}, expired ${expired.length} members`);
}

// ── AUTO-COMPLETE SESSIONS ────────────────────────────────────
// Called every hour by cron — completes sessions 12h after their end time
async function autoCompleteSessions() {
  const { rows: sessions } = await query(
    `SELECT id, name FROM sessions
     WHERE status='upcoming'
       AND COALESCE(ends_at, scheduled_at + (duration_mins * INTERVAL '1 minute'))
           < NOW() - INTERVAL '12 hours'`
  );

  for (const session of sessions) {
    await query(
      "UPDATE sessions SET status='completed', completed_at=NOW() WHERE id=$1",
      [session.id]
    );
    // Award points to attended members
    const { rows: bookings } = await query(
      `SELECT b.member_id, s.points_reward
       FROM bookings b JOIN sessions s ON s.id=b.session_id
       WHERE b.session_id=$1 AND b.status='attended' AND b.points_awarded=0`,
      [session.id]
    );
    for (const b of bookings) {
      await awardPoints(b.member_id, b.points_reward, 'session_checkin',
        `Session attendance: ${session.name}`, session.id);
      await query(
        'UPDATE bookings SET points_awarded=$1 WHERE session_id=$2 AND member_id=$3',
        [b.points_reward, session.id, b.member_id]
      );
    }
    console.log(`Auto-completed session: ${session.name} (${bookings.length} members awarded points)`);
  }
}

module.exports = {
  awardPoints,
  processAnniversaries,
  processReferralPoints,
  processExpiringPoints,
  autoCompleteSessions,
};
