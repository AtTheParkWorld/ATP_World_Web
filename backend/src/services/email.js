const sgMail = require('@sendgrid/mail');
require('dotenv').config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM = {
  email: process.env.EMAIL_FROM || 'no-reply@atthepark.world',
  name:  process.env.EMAIL_FROM_NAME || 'At The Park',
};

// ── EMAIL TEMPLATES ───────────────────────────────────────────
function baseTemplate(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; background:#0a0a0a; color:#ffffff; }
  .wrap { max-width:600px; margin:0 auto; }
  .header { background:#0a0a0a; padding:32px 40px 24px; border-bottom:3px solid #7AC231; }
  .logo { font-family:Arial Black,Arial,sans-serif; font-size:22px; font-weight:900;
          letter-spacing:.1em; text-transform:uppercase; color:#ffffff; }
  .logo span { color:#7AC231; }
  .body { background:#111111; padding:40px; }
  .footer { background:#0a0a0a; padding:24px 40px; text-align:center;
            font-size:12px; color:#555; border-top:1px solid #1a1a1a; }
  .btn { display:inline-block; background:#7AC231; color:#000000 !important;
         padding:14px 32px; border-radius:8px; text-decoration:none;
         font-weight:700; font-size:15px; letter-spacing:.02em; margin:24px 0; }
  h1 { font-size:28px; font-weight:900; text-transform:uppercase;
       letter-spacing:-.01em; color:#ffffff; margin-bottom:16px; }
  p { font-size:15px; color:#cccccc; line-height:1.7; margin-bottom:16px; }
  .stat { display:inline-block; background:#1a1a1a; padding:16px 24px;
          border-radius:8px; margin:8px 8px 8px 0; text-align:center; }
  .stat-num { font-size:28px; font-weight:900; color:#7AC231; display:block; }
  .stat-label { font-size:11px; color:#666; text-transform:uppercase;
                letter-spacing:.08em; }
  .qr-box { background:#1a1a1a; border:1px solid #2a2a2a; border-radius:12px;
            padding:24px; text-align:center; margin:24px 0; }
  .qr-token { font-size:20px; font-weight:700; color:#7AC231; font-family:monospace;
              letter-spacing:.1em; }
  .divider { border:none; border-top:1px solid #222; margin:24px 0; }
  .muted { font-size:12px; color:#555; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">AT THE <span>PARK</span></div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>© ${new Date().getFullYear()} At The Park. Never Train Alone.</p>
    <p style="margin-top:8px">
      <a href="https://atthepark.world" style="color:#7AC231;text-decoration:none">atthepark.world</a>
      &nbsp;·&nbsp;
      <a href="mailto:general@atthepark.world" style="color:#555;text-decoration:none">general@atthepark.world</a>
    </p>
  </div>
</div>
</body>
</html>`;
}

// ── SEND HELPER ───────────────────────────────────────────────
async function send(to, subject, html) {
  if (!process.env.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY.startsWith('SG.xxx')) {
    console.log(`[EMAIL MOCK] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    await sgMail.send({ to, from: FROM, subject, html });
  } catch (err) {
    console.error('SendGrid error:', err.response?.body?.errors || err.message);
  }
}

// ── WELCOME EMAIL ─────────────────────────────────────────────
async function sendWelcome(member) {
  const html = baseTemplate(`
    <h1>Welcome, ${member.first_name}! 🎉</h1>
    <p>You are now an official ATP member. Every session is free. The community is waiting.</p>
    <p>Here's what you can do right now:</p>
    <div class="stat">
      <span class="stat-num">📅</span>
      <span class="stat-label">Book a session</span>
    </div>
    <div class="stat">
      <span class="stat-num">🏆</span>
      <span class="stat-label">Earn points</span>
    </div>
    <div class="stat">
      <span class="stat-num">👥</span>
      <span class="stat-label">Join the community</span>
    </div>
    <br>
    <a href="${process.env.FRONTEND_URL}/sessions.html" class="btn">Book your first session →</a>
    <hr class="divider">
    <p class="muted">Your member number is <strong style="color:#7AC231">${member.member_number}</strong>. 
    Keep this safe — it's on your check-in QR code.</p>
  `);
  await send(member.email, 'Welcome to At The Park 🌿', html);
}

// ── MAGIC LINK ────────────────────────────────────────────────
async function sendMagicLink(member, magicUrl) {
  const html = baseTemplate(`
    <h1>Your login link</h1>
    <p>Hi ${member.first_name}, here's your one-click login link for At The Park.</p>
    <a href="${magicUrl}" class="btn">Log in to ATP →</a>
    <p class="muted">This link expires in 1 hour and can only be used once.<br>
    If you didn't request this, you can ignore this email.</p>
  `);
  await send(member.email, 'Your ATP login link', html);
}

// ── BOOKING CONFIRMATION ──────────────────────────────────────
async function sendBookingConfirmation(member, session, qrData, qrToken) {
  const sessionDate = new Date(session.scheduled_at).toLocaleString('en-AE', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });

  const html = baseTemplate(`
    <h1>You're booked! ✅</h1>
    <p>See you at <strong style="color:#7AC231">${session.session_name || session.name}</strong>.</p>

    <div style="background:#1a2a0a;border:1px solid #2a4a1a;border-radius:12px;padding:20px;margin:20px 0">
      <p style="margin:0 0 6px"><strong>📅 When:</strong> ${sessionDate}</p>
      <p style="margin:0 0 6px"><strong>📍 Where:</strong> ${session.location}</p>
      ${session.city_name ? `<p style="margin:0"><strong>🌆 City:</strong> ${session.city_name}</p>` : ''}
    </div>

    <div class="qr-box">
      <p style="margin-bottom:12px;color:#999;font-size:13px">YOUR CHECK-IN CODE</p>
      <div class="qr-token">${qrToken.toUpperCase()}</div>
      <p style="margin-top:12px;color:#555;font-size:12px">
        Show this code or the QR code in your ATP profile to the ambassador at the session.
      </p>
    </div>

    <a href="${process.env.FRONTEND_URL}/profile.html" class="btn">View QR in profile →</a>

    <hr class="divider">
    <p class="muted">
      Need to cancel? Free sessions can be cancelled any time before the session starts.
      ${session.session_type === 'paid' ? 'Paid sessions: cancel at least 12 hours before.' : ''}
    </p>
  `);
  await send(member.email, `Booking confirmed: ${session.session_name || session.name}`, html);
}

// ── MIGRATION MAGIC LINK ──────────────────────────────────────
async function sendMigrationClaim(member, magicUrl) {
  const html = baseTemplate(`
    <h1>Your ATP account is ready 🌿</h1>
    <p>Hi ${member.first_name},</p>
    <p>At The Park has launched its new platform. Your existing membership has been migrated — 
    your points, history, and everything else is waiting for you.</p>
    <p>Click below to claim your account. No new password needed.</p>
    <a href="${magicUrl}" class="btn">Claim my account →</a>

    ${member.points_balance > 0 ? `
    <div class="qr-box">
      <span class="stat-num">${member.points_balance}</span>
      <span class="stat-label" style="display:block;margin-top:6px">ATP points waiting for you</span>
    </div>` : ''}

    <hr class="divider">
    <p class="muted">This link expires in 24 hours. If you have any issues, reply to this email.</p>
  `);
  await send(member.email, 'Your ATP account is ready — claim it now', html);
}

// ── STREAK REMINDER ───────────────────────────────────────────
async function sendStreakReminder(member, streakDays) {
  const html = baseTemplate(`
    <h1>🔥 Don't break your streak!</h1>
    <p>Hi ${member.first_name}, you're on a <strong style="color:#7AC231">${streakDays}-day streak</strong>. 
    Don't stop now.</p>
    <p>There are sessions today. Show up, check in, and keep the fire going.</p>
    <a href="${process.env.FRONTEND_URL}/sessions.html" class="btn">Find a session today →</a>
  `);
  await send(member.email, `🔥 ${streakDays}-day streak — keep it going!`, html);
}

// ── POINTS EXPIRY WARNING ─────────────────────────────────────
async function sendPointsExpiryWarning(member, expiringPoints, expiresAt) {
  const expiryDate = new Date(expiresAt).toLocaleDateString('en-AE', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const html = baseTemplate(`
    <h1>⏰ Your points are expiring soon</h1>
    <p>Hi ${member.first_name}, you have <strong style="color:#7AC231">${expiringPoints} ATP points</strong> 
    expiring on <strong>${expiryDate}</strong>.</p>
    <p>Use them in the ATP store before they expire.</p>
    <a href="${process.env.FRONTEND_URL}/store.html" class="btn">Shop with points →</a>
  `);
  await send(member.email, `⏰ ${expiringPoints} ATP points expiring soon`, html);
}

// ── SESSION REMINDER ──────────────────────────────────────────
async function sendSessionReminder(member, session) {
  const sessionDate = new Date(session.scheduled_at).toLocaleString('en-AE', {
    weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });
  const html = baseTemplate(`
    <h1>📅 Session in 10 hours</h1>
    <p>Hi ${member.first_name}, just a reminder — you're booked for 
    <strong style="color:#7AC231">${session.name}</strong> ${sessionDate} at ${session.location}.</p>
    <p>Your QR code is saved in your ATP profile. See you there! 💪</p>
    <a href="${process.env.FRONTEND_URL}/profile.html" class="btn">View my QR code →</a>
  `);
  await send(member.email, `Reminder: ${session.name} in 10 hours`, html);
}

// ── Generic raw send (used by ambassador application + future free-form) ─
async function sendRaw({ to, subject, html, replyTo }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('[email] SENDGRID_API_KEY missing — would have sent to', to, 'subject:', subject);
    return;
  }
  const msg = { to, from: FROM, subject, html };
  if (replyTo) msg.replyTo = replyTo;
  await sgMail.send(msg);
}

// ── SESSION CANCELLATION (Audit 4.2) ──────────────────────────
// Notifies a single member that their booked session was cancelled,
// with refund context (points returned / Stripe refund / forfeited).
// Called by the session-cancel + booking-cancel paths on top of the
// in-app notifications row.
async function sendSessionCancellation(member, session, refund) {
  const dt = session.scheduled_at ? new Date(session.scheduled_at) : null;
  const when = dt ? dt.toLocaleString('en-GB', { weekday:'long', day:'2-digit', month:'long', hour:'2-digit', minute:'2-digit' }) : 'TBD';
  const refundLine = refund && refund.refunded_points
    ? `<p>We\u2019ve credited <strong>${refund.refunded_points} points</strong> back to your wallet.</p>`
    : refund && refund.refunded_amount
      ? `<p>A refund of <strong>${refund.refunded_currency || 'AED'} ${Number(refund.refunded_amount).toFixed(2)}</strong> has been issued to your card. Funds appear in 5\u201310 business days.</p>`
      : refund && refund.within_12h
        ? '<p style="color:#aaa">As your booking was inside the 12-hour window, no refund applies.</p>'
        : '';
  const reasonLine = session.cancellation_reason
    ? `<p style="background:#1a1a1a;padding:14px 18px;border-radius:8px;border-left:3px solid #7AC231"><strong>Why:</strong> ${escapeHtml(session.cancellation_reason)}</p>`
    : '';
  const html = baseTemplate(
    `<h1>Session cancelled</h1>
     <p>Hi ${escapeHtml(member.first_name || 'there')},</p>
     <p>Your booking for <strong>${escapeHtml(session.name || 'Session')}</strong> on ${when} has been cancelled.</p>
     ${reasonLine}
     ${refundLine}
     <p>You can browse upcoming sessions and rebook anytime.</p>
     <a href="https://atpworldweb-production.up.railway.app/sessions.html" class="btn">Browse sessions</a>`
  );
  await send(member.email, `Cancelled: ${session.name || 'Your ATP session'}`, html);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  sendWelcome,
  sendMagicLink,
  sendBookingConfirmation,
  sendMigrationClaim,
  sendStreakReminder,
  sendPointsExpiryWarning,
  sendSessionReminder,
  sendSessionCancellation,
  sendRaw,
};
