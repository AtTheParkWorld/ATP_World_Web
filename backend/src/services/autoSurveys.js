/**
 * Auto-triggered surveys — R-SV-006 / OQ-40 (v1.57.0).
 *
 * Three event-driven survey notifications:
 *   1. POST-SESSION NPS  — 1h after a session ends, every attended
 *                          member gets a 1-question rating prompt.
 *   2. 30-DAY PULSE      — members on day 30 since signup get a
 *                          single welcome-check question.
 *   3. PRE-CANCEL EXIT   — when a Stripe subscription is cancelled,
 *                          the member gets a "why?" prompt.
 *
 * Each trigger inserts an in-app notification of type
 * 'survey_invite' pointing at /surveys/<slug>. The survey UI
 * already exists (see /routes/surveys.js — public submit endpoint
 * at /api/surveys/public/<slug>/submit).
 *
 * Idempotency: each notification check uses (member_id, type,
 * data->>'survey_slug', + optionally data->>'session_id') to detect
 * already-sent invites. Re-running the cron is safe.
 *
 * The three survey templates themselves are seeded by the
 * /api/auth/migrate-auto-surveys maintenance endpoint.
 */
const { query } = require('../db');

const SLUG_POST_SESSION  = 'post-session-nps';
const SLUG_SIGNUP_PULSE  = 'signup-30day-pulse';
const SLUG_PRE_CANCEL    = 'pre-cancel-exit';

// ──────────────────────────────────────────────────────────────
// 1. POST-SESSION NPS
//
// Triggers ~1h after a session's scheduled end. The "1h" is built
// into the cron's WHERE clause — we look for sessions that ended
// between 60 and 120 minutes ago (1h grace so the hourly cron
// doesn't miss anything, and 2h cap so we don't re-survey old
// sessions on cron catch-up after an outage).
//
// Returns { sessions, invites_inserted, skipped }.
// ──────────────────────────────────────────────────────────────
async function triggerPostSessionNPS() {
  let sessions;
  try {
    ({ rows: sessions } = await query(`
      SELECT id, name, scheduled_at, ends_at
        FROM sessions
       WHERE status IN ('completed','upcoming')
         AND COALESCE(ends_at, scheduled_at + INTERVAL '90 minutes')
             BETWEEN NOW() - INTERVAL '120 minutes' AND NOW() - INTERVAL '60 minutes'
    `));
  } catch (e) {
    if (e.code === '42P01') return { sessions: 0, invites_inserted: 0, skipped: 0 };
    throw e;
  }

  let invitesInserted = 0, skipped = 0;
  for (const s of sessions) {
    const { rows: attendees } = await query(
      `SELECT b.member_id
         FROM bookings b
        WHERE b.session_id = $1 AND b.status = 'attended'`,
      [s.id]
    );
    if (!attendees.length) continue;
    for (const a of attendees) {
      // Idempotency: skip if we already sent this member the NPS for this session.
      const { rows: existing } = await query(
        `SELECT 1 FROM notifications
          WHERE member_id = $1
            AND type      = 'survey_invite'
            AND data->>'survey_slug' = $2
            AND data->>'session_id'  = $3
          LIMIT 1`,
        [a.member_id, SLUG_POST_SESSION, s.id]
      );
      if (existing.length) { skipped++; continue; }

      try {
        await query(
          `INSERT INTO notifications (member_id, type, title, body, data)
           VALUES ($1, 'survey_invite', $2, $3, $4)`,
          [
            a.member_id,
            `How was ${s.name || 'your session'}?`,
            'Rate it in 5 seconds — your feedback shapes future sessions.',
            JSON.stringify({
              survey_slug: SLUG_POST_SESSION,
              session_id:  s.id,
              session_name: s.name,
              url: `/surveys/${SLUG_POST_SESSION}?session=${s.id}`,
            }),
          ]
        );
        invitesInserted++;
      } catch (e) {
        // notifications table missing → bail out; the cron is no-op
        if (e.code === '42P01') return { sessions: sessions.length, invites_inserted: invitesInserted, skipped };
        console.warn('[autoSurveys] NPS insert failed:', e.message);
      }
    }
  }
  return { sessions: sessions.length, invites_inserted: invitesInserted, skipped };
}

// ──────────────────────────────────────────────────────────────
// 2. 30-DAY POST-SIGNUP PULSE
//
// Daily cron: members whose joined_at falls on (today - 30 days)
// IN THEIR LOCAL TIMEZONE get a 1-question welcome check. Banned
// members excluded. Idempotency via the same survey_slug check.
// Window is ±12h so the cron is resilient to timezone shifts +
// hourly drift.
// ──────────────────────────────────────────────────────────────
async function trigger30DayPulse() {
  let candidates;
  try {
    ({ rows: candidates } = await query(`
      SELECT id, first_name, COALESCE(timezone, 'Asia/Dubai') AS timezone
        FROM members
       WHERE is_banned = false
         AND joined_at BETWEEN NOW() - INTERVAL '30 days' - INTERVAL '12 hours'
                           AND NOW() - INTERVAL '30 days' + INTERVAL '12 hours'
    `));
  } catch (e) {
    if (e.code === '42P01') return { members: 0, invites_inserted: 0, skipped: 0 };
    // members.timezone column may be missing on pre-migration DB.
    if (e.code === '42703') {
      ({ rows: candidates } = await query(`
        SELECT id, first_name, 'Asia/Dubai' AS timezone
          FROM members
         WHERE is_banned = false
           AND joined_at BETWEEN NOW() - INTERVAL '30 days' - INTERVAL '12 hours'
                             AND NOW() - INTERVAL '30 days' + INTERVAL '12 hours'
      `));
    } else { throw e; }
  }

  let inserted = 0, skipped = 0;
  for (const m of candidates) {
    const { rows: existing } = await query(
      `SELECT 1 FROM notifications
        WHERE member_id = $1 AND type='survey_invite'
          AND data->>'survey_slug' = $2 LIMIT 1`,
      [m.id, SLUG_SIGNUP_PULSE]
    );
    if (existing.length) { skipped++; continue; }
    try {
      await query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         VALUES ($1, 'survey_invite', $2, $3, $4)`,
        [
          m.id,
          `${m.first_name || 'Hey'} — how's ATP going?`,
          'One quick question — 30 seconds. Your honest answer shapes what we build next.',
          JSON.stringify({
            survey_slug: SLUG_SIGNUP_PULSE,
            url: `/surveys/${SLUG_SIGNUP_PULSE}`,
          }),
        ]
      );
      inserted++;
    } catch (e) {
      if (e.code === '42P01') return { members: candidates.length, invites_inserted: inserted, skipped };
      console.warn('[autoSurveys] 30-day pulse insert failed:', e.message);
    }
  }
  return { members: candidates.length, invites_inserted: inserted, skipped };
}

// ──────────────────────────────────────────────────────────────
// 3. PRE-CANCEL EXIT
//
// Called inline by the Stripe webhook handler on
// customer.subscription.deleted. Inserts the survey invite once per
// (member_id, cancel event). The webhook is idempotent (Stripe
// retries) so we double-check existing notifs.
// ──────────────────────────────────────────────────────────────
async function triggerPreCancelExit(memberId) {
  if (!memberId) return null;
  try {
    const { rows: existing } = await query(
      `SELECT 1 FROM notifications
        WHERE member_id = $1 AND type='survey_invite'
          AND data->>'survey_slug' = $2
          AND created_at > NOW() - INTERVAL '7 days'
        LIMIT 1`,
      [memberId, SLUG_PRE_CANCEL]
    );
    if (existing.length) return { skipped: true };
    await query(
      `INSERT INTO notifications (member_id, type, title, body, data)
       VALUES ($1, 'survey_invite', $2, $3, $4)`,
      [
        memberId,
        'Sorry to see you go — one quick question',
        'What pushed you to cancel? Your answer helps us improve.',
        JSON.stringify({
          survey_slug: SLUG_PRE_CANCEL,
          url: `/surveys/${SLUG_PRE_CANCEL}`,
        }),
      ]
    );
    return { inserted: true };
  } catch (e) {
    if (e.code === '42P01') return null;
    console.warn('[autoSurveys] pre-cancel exit insert failed:', e.message);
    return null;
  }
}

module.exports = {
  triggerPostSessionNPS,
  trigger30DayPulse,
  triggerPreCancelExit,
  SLUG_POST_SESSION,
  SLUG_SIGNUP_PULSE,
  SLUG_PRE_CANCEL,
};
