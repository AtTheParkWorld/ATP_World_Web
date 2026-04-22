/**
 * ATP World Email Service
 * Uses nodemailer — configure SMTP via env vars
 */
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const FROM = process.env.EMAIL_FROM || '"At The Park" <hello@atthepark.world>';

// ── Helpers ───────────────────────────────────────────────────
function baseTemplate(title, body) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px}
  .logo{font-size:22px;font-weight:900;letter-spacing:-0.5px;margin-bottom:32px}
  .logo span{color:#7AC231}
  .title{font-size:28px;font-weight:900;text-transform:uppercase;margin-bottom:8px}
  .sub{color:#888;font-size:14px;margin-bottom:28px;line-height:1.5}
  .card{background:#111;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:24px;margin:20px 0}
  .label{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}
  .value{font-size:15px;font-weight:600;color:#fff}
  .btn{display:inline-block;background:#7AC231;color:#000;font-weight:800;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin:20px 0}
  .footer{margin-top:40px;font-size:12px;color:#444;border-top:1px solid #1a1a1a;padding-top:20px}
  .green{color:#7AC231}
</style></head>
<body><div class="wrap">
  <div class="logo">@ THE PARK</div>
  ${body}
  <div class="footer">
    At The Park · Dubai, Al Ain &amp; Muscat<br>
    <a href="https://attheparkworld.github.io/ATP_World_Web" style="color:#444">atthepark.world</a>
  </div>
</div></body></html>`;
}

// ── Welcome email ─────────────────────────────────────────────
async function sendWelcome(member) {
  if (!process.env.SMTP_USER) return; // skip if not configured
  const html = baseTemplate('Welcome', `
    <div class="title">Welcome to<br><span class="green">At The Park</span></div>
    <p class="sub">You're now part of the UAE's largest free outdoor fitness community. 
    7,000+ members. 19 activities. Dubai, Al Ain &amp; Muscat. Every session is free.</p>
    <div class="card">
      <div class="label">Member ID</div>
      <div class="value">${member.member_number}</div>
    </div>
    <p style="color:#888;font-size:14px;line-height:1.6">
      <strong style="color:#fff">What's next?</strong><br>
      Browse upcoming sessions and book your first one. Show up, check in, earn points. 
      The community is waiting for you.
    </p>
    <a class="btn" href="https://attheparkworld.github.io/ATP_World_Web/sessions.html">
      Book your first session →
    </a>
  `);
  await transporter.sendMail({
    from: FROM, to: member.email,
    subject: `Welcome to At The Park, ${member.first_name}! 🎉`,
    html,
  });
  console.log(`📧 Welcome email sent to ${member.email}`);
}

// ── Booking confirmation ──────────────────────────────────────
async function sendBookingConfirmation(member, session, booking) {
  if (!process.env.SMTP_USER) return;
  const dt = new Date(session.scheduled_at);
  const dateStr = dt.toLocaleDateString('en-AE', {weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const timeStr = dt.toLocaleTimeString('en-AE', {hour:'2-digit',minute:'2-digit'});

  const html = baseTemplate('Booking Confirmed', `
    <div class="title">You're in! <span class="green">✓</span></div>
    <p class="sub">Your spot is confirmed. Show your QR code to the ambassador at check-in.</p>
    <div class="card">
      <div class="label">Session</div>
      <div class="value">${session.name}</div>
      <br>
      <div class="label">Date &amp; Time</div>
      <div class="value">${dateStr} · ${timeStr}</div>
      <br>
      <div class="label">Location</div>
      <div class="value">${session.location}</div>
      <br>
      <div class="label">Points on completion</div>
      <div class="value green">+${session.points_reward || 10} pts</div>
    </div>
    <a class="btn" href="https://attheparkworld.github.io/ATP_World_Web/profile.html">
      View your QR code →
    </a>
    <p style="color:#555;font-size:12px;margin-top:16px">
      Booking ID: ${booking.id}<br>
      Can't make it? You can cancel from your profile page.
    </p>
  `);

  await transporter.sendMail({
    from: FROM, to: member.email,
    subject: `Booking confirmed: ${session.name} 📍`,
    html,
  });
  console.log(`📧 Booking confirmation sent to ${member.email}`);
}

module.exports = { sendWelcome, sendBookingConfirmation };
