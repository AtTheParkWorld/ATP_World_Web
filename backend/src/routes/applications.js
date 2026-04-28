// Applications routes — community-driven submissions that the ATP team
// reviews manually (Ambassador, future Coach). Each submission is emailed
// to general@atthepark.world for triage. We DON'T persist these in the DB
// yet — Phase 1 is intentionally light (audit trail can be added later
// once the volume justifies a CRM-style queue).

const router  = require('express').Router();
const email   = require('../services/email');
const audit   = require('../services/audit');
const rateLimit = require('express-rate-limit');

// Stricter rate limit on this surface — anonymous attackers shouldn't be
// able to spam our inbox. 3 applications / 15 min / IP.
const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many applications submitted. Please try again later.' },
});

const APPLY_TO = process.env.APPLICATIONS_INBOX || 'general@atthepark.world';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

// ── POST /api/applications/ambassador ─────────────────────────
router.post('/ambassador', applyLimiter, async (req, res, next) => {
  try {
    const {
      first_name, last_name, nationality, gender,
      sessions, area, why,
      member_id, email: memberEmail,
    } = req.body || {};

    if (!first_name || !last_name || !sessions || !area || !why) {
      return res.status(400).json({ error: 'Required: first_name, last_name, sessions, area, why' });
    }

    const subject = `Ambassador application — ${first_name} ${last_name}`;
    const html = `
      <h2 style="font-family:Arial,sans-serif;color:#7AC231">⭐ New Ambassador application</h2>
      <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:560px">
        <tr><td style="padding:6px 12px 6px 0;color:#888;width:140px">Name</td><td><strong>${esc(first_name)} ${esc(last_name)}</strong></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#888">Email</td><td>${esc(memberEmail || '—')}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#888">Nationality</td><td>${esc(nationality || '—')}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#888">Gender</td><td>${esc(gender || '—')}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#888">Member ID</td><td>${esc(member_id || '—')}</td></tr>
      </table>
      <h3 style="font-family:Arial,sans-serif;color:#fff;margin-top:24px">Sessions they can support</h3>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#ccc;line-height:1.6">${esc(sessions)}</p>
      <h3 style="font-family:Arial,sans-serif;color:#fff;margin-top:18px">Area / city</h3>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#ccc;line-height:1.6">${esc(area)}</p>
      <h3 style="font-family:Arial,sans-serif;color:#fff;margin-top:18px">Why they want to be an Ambassador</h3>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#ccc;line-height:1.6">${esc(why)}</p>
      <hr style="margin-top:24px;border:none;border-top:1px solid #2a2a2a">
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#666">Reply directly to this email to reach the applicant. Promote them in the admin panel → Members → Make Ambassador once approved.</p>
    `;

    try {
      await email.sendRaw({
        to: APPLY_TO,
        subject,
        html,
        replyTo: memberEmail || undefined,
      });
    } catch (err) {
      console.error('[applications] email send failed:', err.message);
      return res.status(502).json({ error: 'Could not deliver your application. Please email general@atthepark.world directly.' });
    }

    audit.log(req, 'application.ambassador.submitted', 'member', member_id || null, {
      sessions: sessions.slice(0, 200),
      area:     area.slice(0, 200),
    });

    res.json({ success: true, message: 'Application sent — we\u2019ll be in touch shortly.' });
  } catch (err) { next(err); }
});

module.exports = router;
