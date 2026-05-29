const sgMail = require('@sendgrid/mail');
require('dotenv').config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM = {
  email: process.env.EMAIL_FROM || 'no-reply@atthepark.world',
  name:  process.env.EMAIL_FROM_NAME || 'At The Park',
};

// Public site URL used in transactional emails. Falls back to the live
// Railway URL if FRONTEND_URL isn't set so emailed links never break.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://atp-world-web.onrender.com').replace(/\/$/, '');

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
// Lightweight status string the caller can use to surface delivery
// state to the user. Most callers will await send() and ignore — only
// flows that NEED confirmation (magic-link, password-reset) should
// inspect the return value or rethrow.
function emailServiceStatus() {
  const key = process.env.SENDGRID_API_KEY || '';
  if (!key || key.startsWith('SG.xxx')) {
    return { configured: false, reason: 'SENDGRID_API_KEY env var is missing or set to a placeholder.' };
  }
  if (!key.startsWith('SG.')) {
    return { configured: false, reason: 'SENDGRID_API_KEY does not look like a SendGrid key (expected to start with "SG.").' };
  }
  return { configured: true };
}

// send() never throws — it returns a result object the caller may inspect
// when delivery is critical (magic-link, password-reset). Routes that
// don't care can `await send(...)` and ignore the return value, preserving
// the previous fire-and-forget behaviour for welcome / booking / points emails.
//   Returns: { ok:true } on success
//            { ok:false, code:'EMAIL_NOT_CONFIGURED', reason } when env not set
//            { ok:false, code:'EMAIL_SEND_FAILED',    reason } on SendGrid error
async function send(to, subject, html) {
  const status = emailServiceStatus();
  if (!status.configured) {
    console.warn(`[EMAIL MOCK] To: ${to} | Subject: ${subject} | Reason: ${status.reason}`);
    return { ok: false, code: 'EMAIL_NOT_CONFIGURED', reason: status.reason };
  }
  try {
    await sgMail.send({ to, from: FROM, subject, html });
    return { ok: true };
  } catch (err) {
    const sgErrors = err.response?.body?.errors;
    const reason = sgErrors
      ? sgErrors.map(e => e.message).join('; ')
      : (err.message || 'Unknown SendGrid error');
    console.error('SendGrid error:', sgErrors || err.message);
    return { ok: false, code: 'EMAIL_SEND_FAILED', reason };
  }
}

// ── WELCOME EMAIL ─────────────────────────────────────────────
// `opts.welcome` is an optional object returned by welcomeDiscount.issueWelcomeDiscount()
// containing { code, expires_at, percentage, expiry_days }. When present
// (i.e. Shopify is configured + the code was created OK), we embed a
// prominent discount block. When absent, the email gracefully omits it.
async function sendWelcome(member, opts) {
  const w = (opts && opts.welcome) || null;
  let discountBlock = '';
  if (w && w.code) {
    const expiresStr = w.expires_at
      ? new Date(w.expires_at).toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' })
      : null;
    const pct = w.percentage || 20;
    discountBlock = `
      <div class="qr-box" style="background:linear-gradient(120deg,rgba(245,192,66,.16),rgba(245,192,66,.04));border:1px solid rgba(245,192,66,.4);text-align:center">
        <div style="font-size:11px;color:#f5c042;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:8px">🎁 Welcome gift</div>
        <h2 style="font-size:22px;color:#fff;text-transform:uppercase;margin-bottom:6px">${pct}% off your first ATP store order</h2>
        <p style="margin:0 0 12px;color:#ddd;font-size:13px">Use this code at checkout. Single-use, valid${expiresStr ? ' until <strong style="color:#f5c042">' + escapeHtml(expiresStr) + '</strong>' : ''}.</p>
        <div class="qr-token" style="background:rgba(0,0,0,.4);display:inline-block;padding:14px 26px;border-radius:8px;margin-bottom:6px;color:#f5c042;font-size:22px;letter-spacing:.12em">${escapeHtml(w.code)}</div>
        <br>
        <a href="${FRONTEND_URL}/store.html" class="btn" style="margin-top:8px">Shop ATP gear →</a>
      </div>
    `;
  }
  const html = baseTemplate(`
    <h1>Welcome, ${escapeHtml(member.first_name)}! 🎉</h1>
    <p>You are now an official ATP member. Every session is free. The community is waiting.</p>
    ${discountBlock}
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
    <a href="${FRONTEND_URL}/sessions.html" class="btn">Book your first session →</a>
    <hr class="divider">
    <p class="muted">Your member number is <strong style="color:#7AC231">${escapeHtml(member.member_number || '')}</strong>.
    Keep this safe — it's on your check-in QR code.</p>
  `);
  await send(member.email, 'Welcome to At The Park 🌿', html);
}

// ── MAGIC LINK ────────────────────────────────────────────────
// ── COACH CONTACT MESSAGE ─────────────────────────────────────
// Sent to a coach when a visitor uses the "Send a message" form on
// their profile page. Returns the same { ok, code, reason } shape as
// send() so callers can choose to surface failures.
async function sendCoachMessage(coach, payload) {
  const safe = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const replyTo = safe(payload.email);
  const body = baseTemplate(`
    <h1>New message — ${safe(coach.first_name)}</h1>
    <p>You have a new inquiry from your ATP coach profile.</p>
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;margin:20px 0">
      <p style="margin:0 0 10px"><strong style="color:#7AC231">From:</strong> ${safe(payload.name)} &lt;${replyTo}&gt;</p>
      ${payload.phone   ? `<p style="margin:0 0 10px"><strong style="color:#7AC231">Phone:</strong> ${safe(payload.phone)}</p>` : ''}
      ${payload.subject ? `<p style="margin:0 0 10px"><strong style="color:#7AC231">Subject:</strong> ${safe(payload.subject)}</p>` : ''}
      <p style="margin:14px 0 0;white-space:pre-wrap">${safe(payload.message)}</p>
    </div>
    <p class="muted">Reply directly to this email to respond — your reply will go to <strong>${replyTo}</strong>.</p>
  `);
  // Use an explicit reply-to so the coach can hit "Reply" and reach the
  // sender directly without ATP being in the loop.
  const status = emailServiceStatus();
  if (!status.configured) {
    console.warn('[EMAIL MOCK] sendCoachMessage', { to: coach.email, from: payload.email });
    return { ok: false, code: 'EMAIL_NOT_CONFIGURED', reason: status.reason };
  }
  try {
    await sgMail.send({
      to: coach.email,
      from: FROM,
      replyTo: payload.email,
      subject: `[ATP] New message from ${payload.name}` + (payload.subject ? ` — ${payload.subject}` : ''),
      html: body,
    });
    return { ok: true };
  } catch (err) {
    const sgErrors = err.response?.body?.errors;
    const reason = sgErrors ? sgErrors.map(e => e.message).join('; ') : (err.message || 'Unknown SendGrid error');
    console.error('SendGrid error (sendCoachMessage):', sgErrors || err.message);
    return { ok: false, code: 'EMAIL_SEND_FAILED', reason };
  }
}

// ── COACH MESSAGE THREADS ──────────────────────────────────────
// Two emails per thread event: one to the coach, one to the visitor.
// Same template, different framing — controlled by recipient='coach'|'visitor'.
async function sendCoachThreadInitial(envelope, payload) {
  const safe = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isCoach = envelope.recipient === 'coach';
  const subject = isCoach
    ? `[ATP] New message from ${payload.name}` + (payload.subject ? ` — ${payload.subject}` : '')
    : `Your message to ${envelope.coachLabel} — At The Park`;

  const intro = isCoach
    ? `<p>Hi ${safe(envelope.coachFirstName)}, you have a new inquiry from your ATP coach profile.</p>`
    : `<p>Hi ${safe(payload.name.split(' ')[0])}, thanks for reaching out to <strong style="color:#7AC231">${safe(envelope.coachLabel)}</strong>. Your message landed in their inbox — they usually reply within 24 hours.</p>`;

  const cta = isCoach
    ? `<a href="${payload.threadUrl}" class="btn">Open conversation →</a>
       <p class="muted" style="margin-top:8px">Or just hit reply on this email — your reply will go to <strong>${safe(payload.email)}</strong>.</p>`
    : `<p>You can come back to this conversation any time:</p>
       <a href="${payload.threadUrl}" class="btn">Open the conversation →</a>
       <p class="muted" style="margin-top:8px">Bookmark that link — no login needed.</p>`;

  const body = baseTemplate(`
    <h1>${isCoach ? 'New inquiry' : 'Message received'}</h1>
    ${intro}
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;margin:20px 0">
      <p style="margin:0 0 8px"><strong style="color:#7AC231">${isCoach ? 'From' : 'To'}:</strong> ${isCoach ? safe(payload.name) + ' &lt;' + safe(payload.email) + '&gt;' : safe(envelope.coachLabel)}</p>
      ${payload.phone   ? `<p style="margin:0 0 8px"><strong style="color:#7AC231">Phone:</strong> ${safe(payload.phone)}</p>` : ''}
      ${payload.subject ? `<p style="margin:0 0 8px"><strong style="color:#7AC231">Subject:</strong> ${safe(payload.subject)}</p>` : ''}
      <p style="margin:14px 0 0;white-space:pre-wrap">${safe(payload.message)}</p>
    </div>
    ${cta}
  `);

  const status = emailServiceStatus();
  if (!status.configured) {
    console.warn('[EMAIL MOCK] sendCoachThreadInitial', { to: envelope.to, recipient: envelope.recipient });
    return { ok: false, code: 'EMAIL_NOT_CONFIGURED', reason: status.reason };
  }
  try {
    const sendArgs = { to: envelope.to, from: FROM, subject, html: body };
    // Coach gets reply-to set to the visitor — hitting Reply emails them directly
    if (isCoach) sendArgs.replyTo = payload.email;
    await sgMail.send(sendArgs);
    return { ok: true };
  } catch (err) {
    const reason = err.response?.body?.errors ? err.response.body.errors.map(e => e.message).join('; ') : err.message;
    console.error('SendGrid error (sendCoachThreadInitial):', reason);
    return { ok: false, code: 'EMAIL_SEND_FAILED', reason };
  }
}

async function sendCoachThreadReply(envelope, payload) {
  const safe = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isCoach = envelope.recipient === 'coach';
  const subject = isCoach
    ? `[ATP] ${envelope.visitorName} replied` + (payload.subject ? ` — ${payload.subject}` : '')
    : `${envelope.coachLabel} replied to your message — At The Park`;

  const intro = isCoach
    ? `<p>Hi ${safe(envelope.coachFirstName)}, <strong style="color:#7AC231">${safe(envelope.visitorName)}</strong> replied in your conversation.</p>`
    : `<p>Hi ${safe(envelope.visitorFirstName)}, <strong style="color:#7AC231">${safe(envelope.coachLabel)}</strong> got back to you.</p>`;

  const body = baseTemplate(`
    <h1>${isCoach ? 'New reply' : 'New reply from your coach'}</h1>
    ${intro}
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;margin:20px 0">
      <p style="margin:14px 0 0;white-space:pre-wrap">${safe(payload.message)}</p>
    </div>
    <a href="${payload.threadUrl}" class="btn">Open the conversation →</a>
    <p class="muted" style="margin-top:8px">Reply directly in the thread — both of you get the full history.</p>
  `);

  const status = emailServiceStatus();
  if (!status.configured) {
    console.warn('[EMAIL MOCK] sendCoachThreadReply', { to: envelope.to, recipient: envelope.recipient });
    return { ok: false, code: 'EMAIL_NOT_CONFIGURED', reason: status.reason };
  }
  try {
    const sendArgs = { to: envelope.to, from: FROM, subject, html: body };
    if (payload.replyTo) sendArgs.replyTo = payload.replyTo;
    await sgMail.send(sendArgs);
    return { ok: true };
  } catch (err) {
    const reason = err.response?.body?.errors ? err.response.body.errors.map(e => e.message).join('; ') : err.message;
    console.error('SendGrid error (sendCoachThreadReply):', reason);
    return { ok: false, code: 'EMAIL_SEND_FAILED', reason };
  }
}

// ── CORPORATE INVITATION ──────────────────────────────────────
// Sent when an admin adds an employee to a company. Branded with
// the company name; the magic link drops them on the accept-invite
// landing page which calls /api/corporate/public/invitation/:token/accept.
async function sendCorporateInvitation({ email, first_name, company_name, company_logo_url, invite_url, sender_name }) {
  const safeFirst = escapeHtml(first_name || 'there');
  const safeCo = escapeHtml(company_name || 'your company');
  const safeSender = escapeHtml(sender_name || 'Your HR team');
  // Validate logo URL scheme before embedding in <img src>. Falls back
  // to no logo if the URL is anything other than https:// or data:image/.
  const logoSafe = company_logo_url && (
    /^https:\/\//i.test(company_logo_url) ||
    /^data:image\/(png|jpe?g|svg\+xml|webp);base64,/i.test(company_logo_url)
  );
  const logoBlock = logoSafe
    ? `<div style="text-align:center;margin:8px 0 20px"><img src="${escapeHtml(company_logo_url)}" alt="${safeCo}" style="max-height:60px;max-width:200px;background:#fff;padding:8px;border-radius:8px"></div>`
    : '';
  // Sanitize subject — strip CR/LF (email-header-injection vector) and
  // cap length so a malicious company_name can't smuggle headers.
  const subjectSafe = String(company_name || '').replace(/[\r\n]+/g, ' ').slice(0, 120);
  const html = baseTemplate(`
    ${logoBlock}
    <h1>You're invited to ATP × ${safeCo}.</h1>
    <p>Hi ${safeFirst},</p>
    <p>${safeSender} just enrolled you in <strong style="color:#7AC231">At The Park</strong> — ${safeCo}'s new wellness program.</p>
    <p>What you get:</p>
    <div class="stat"><span class="stat-num">🏃</span><span class="stat-label">Free outdoor sessions</span></div>
    <div class="stat"><span class="stat-num">💻</span><span class="stat-label">Live online workouts</span></div>
    <div class="stat"><span class="stat-num">🏆</span><span class="stat-label">Company leaderboard</span></div>
    <br><br>
    <a href="${invite_url}" class="btn">Accept invite →</a>
    <hr class="divider">
    <p class="muted">One-tap accept. No app to install. Works on any phone or browser.
    If you're already on ATP, this just links your existing account to ${safeCo} — no duplicate profile.</p>
  `);
  return send(email, `You're invited to ATP × ${subjectSafe}`, html);
}

async function sendMagicLink(member, magicUrl) {
  const html = baseTemplate(`
    <h1>Your login link</h1>
    <p>Hi ${member.first_name}, here's your one-click login link for At The Park.</p>
    <a href="${magicUrl}" class="btn">Log in to ATP →</a>
    <p class="muted">This link expires in 1 hour and can only be used once.<br>
    If you didn't request this, you can ignore this email.</p>
  `);
  return send(member.email, 'Your ATP login link', html);
}

// ── PAID SESSION RECEIPT ──────────────────────────────────────
// Sent immediately after a successful paid-session checkout. Acts as
// proof of payment for the member (insurance reimbursement, expense
// reports, etc.). Separate from the booking-confirmation email — that
// one drives them back to ATP, this one is a static record.
async function sendPaidSessionReceipt({ member, session, payment }) {
  const sessionDate = session.scheduled_at
    ? new Date(session.scheduled_at).toLocaleString('en-AE', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
      })
    : '—';
  const amount = payment.amount != null ? Number(payment.amount).toFixed(2) : '0.00';
  const currency = (payment.currency || 'AED').toUpperCase();
  const paidAt = payment.paid_at
    ? new Date(payment.paid_at).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' })
    : new Date().toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dubai' });
  const html = baseTemplate(`
    <h1>Receipt — payment confirmed ✓</h1>
    <p>Hi ${escapeHtml(member.first_name)}, here's your proof of payment for the session below. Keep this for your records.</p>
    <div class="qr-box" style="text-align:left">
      <div style="font-size:11px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-bottom:10px">Receipt details</div>
      <table style="width:100%;font-size:14px;color:#ddd">
        <tr><td style="padding:4px 0;color:#888">Amount paid</td><td style="text-align:right;color:#fff;font-weight:700;font-family:Arial,sans-serif">${escapeHtml(currency)} ${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:4px 0;color:#888">Paid on</td><td style="text-align:right;color:#fff">${escapeHtml(paidAt)}</td></tr>
        <tr><td style="padding:4px 0;color:#888">Payment method</td><td style="text-align:right;color:#fff">${escapeHtml(payment.method || 'Stripe')}</td></tr>
        ${payment.stripe_payment_intent_id ? `<tr><td style="padding:4px 0;color:#888">Order ref</td><td style="text-align:right;color:#fff;font-family:monospace;font-size:11px">${escapeHtml(payment.stripe_payment_intent_id)}</td></tr>` : ''}
      </table>
      <hr class="divider" style="margin:14px 0">
      <div style="font-size:11px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-bottom:10px">Session</div>
      <table style="width:100%;font-size:14px;color:#ddd">
        <tr><td style="padding:4px 0;color:#888">Name</td><td style="text-align:right;color:#fff">${escapeHtml(session.name || 'ATP session')}</td></tr>
        <tr><td style="padding:4px 0;color:#888">Date</td><td style="text-align:right;color:#fff">${escapeHtml(sessionDate)}</td></tr>
        ${session.location ? `<tr><td style="padding:4px 0;color:#888">Location</td><td style="text-align:right;color:#fff">${escapeHtml(session.location)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#888">Member</td><td style="text-align:right;color:#fff">${escapeHtml(member.first_name + ' ' + (member.last_name || ''))} · ${escapeHtml(member.member_number || '')}</td></tr>
      </table>
    </div>
    <p class="muted">Issued by At The Park · This is an automated receipt. For corrections or refunds, reply to this email or write to <a href="mailto:general@atthepark.com" style="color:#7AC231">general@atthepark.com</a>.</p>
    ${_sponsorBlockHtml(session)}
  `);
  return send(member.email, `Receipt — ${currency} ${amount} · ${session.name || 'ATP session'}`, html);
}

// ── BOOKING CONFIRMATION ──────────────────────────────────────
async function sendBookingConfirmation(member, session, qrData, qrToken) {
  const sessionDate = new Date(session.scheduled_at).toLocaleString('en-AE', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });

  const sponsorHtml = _sponsorBlockHtml(session);

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

    <a href="${FRONTEND_URL}/profile.html" class="btn">View QR in profile →</a>

    <hr class="divider">
    <p class="muted">
      Need to cancel? Free sessions can be cancelled any time before the session starts.
      ${session.session_type === 'paid' ? 'Paid sessions: cancel at least 12 hours before.' : ''}
    </p>
    ${sponsorHtml}
  `);
  await send(member.email, `Booking confirmed: ${session.session_name || session.name}`, html);
}

// Build the "Powered by <sponsor>" block for emails. Returns '' when the
// session has no sponsor logo. Logo + optional click-through link are
// validated/escaped; /api/cms/media refs are made absolute so they load
// in email clients. data: URLs are passed through (most clients block
// them, but https + cms-media refs are the common path).
function _sponsorBlockHtml(session) {
  const logo = String(session.sponsor_logo_url || '').trim();
  if (!logo) return '';
  let src = logo;
  if (/^\/api\/cms\/media\//.test(src)) src = FRONTEND_URL + src;
  else if (!/^https:\/\//i.test(src) && !/^data:image\//i.test(src)) return '';
  const name = escapeHtml(session.sponsor_name || 'our partner');
  const link = String(session.sponsor_url || '').trim();
  const img = `<img src="${escapeHtml(src)}" alt="${name}" style="max-height:44px;max-width:160px;width:auto;height:auto;display:inline-block">`;
  const inner = /^https?:\/\//i.test(link)
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="text-decoration:none">${img}</a>`
    : img;
  return `
    <div style="margin-top:26px;padding-top:20px;border-top:1px solid #222;text-align:center">
      <p style="margin:0 0 10px;color:#777;font-size:11px;letter-spacing:.14em;text-transform:uppercase">Powered by</p>
      ${inner}
    </div>`;
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
    <a href="${FRONTEND_URL}/sessions.html" class="btn">Find a session today →</a>
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
    <a href="${FRONTEND_URL}/store.html" class="btn">Shop with points →</a>
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
    <a href="${FRONTEND_URL}/profile.html" class="btn">View my QR code →</a>
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
     <a href="https://atp-world-web.onrender.com/sessions.html" class="btn">Browse sessions</a>`
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
  emailServiceStatus,
  sendCoachMessage,
  sendCoachThreadInitial,
  sendCoachThreadReply,
  sendCorporateInvitation,
  sendPaidSessionReceipt,
};
