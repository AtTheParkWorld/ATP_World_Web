/**
 * Welcome message from the founder, sent once to every new member.
 *
 * History: founder request 15 (2026-10-03) shipped this as a direct
 * message from the longest-standing admin, signed "Fredy & Tatiana".
 * Founder follow-up 2026-10-05: it is now a note signed by Coach Fredy,
 * delivered as an in-app inbox notification. That puts it in the Inbox
 * and in the big spotlight card on first app open. The welcome email
 * (services/email.js → sendWelcome) carries the same text, so this file
 * is the ONE place the wording lives.
 *
 * Deliberately best-effort: signup must never fail because the welcome
 * could not be delivered. sendWelcomeMessage never throws.
 */
const { query } = require('../db');

// ── EDIT THE WELCOME HERE ─────────────────────────────────────
// {first_name} becomes the member's first name ("there" when we don't
// have a real one). Blank lines split paragraphs in the email.
const FOUNDER_WELCOME_MESSAGE =
  "Hey {first_name}, welcome to At The Park!\n\n" +
  "I started ATP around three words: Never Train Alone. Today we're a " +
  "community training together outdoors in Dubai, Al Ain, Abu Dhabi and " +
  "Muscat — and now you're part of it.\n\n" +
  "Find your tribe — Better, Faster or Stronger — then book your first " +
  "free session and just show up. No experience needed. Come as you are, " +
  "leave with friends.\n\n" +
  "See you at the park!\n" +
  "— Coach Fredy, founder of At The Park";

const FOUNDER_WELCOME_TITLE = 'A message from Coach Fredy';

/** notifications.type — the app routes and labels on it. */
const FOUNDER_WELCOME_TYPE = 'founder_welcome';

// Names the signup paths invent when the provider gives us none
// (Google → "Member", Apple → "Friend"). "Hey Member" reads like a bot.
const PLACEHOLDER_NAMES = new Set(['', 'member', 'friend']);

/** The welcome text personalised for one member. */
function welcomeText(firstName) {
  const name = String(firstName || '').trim();
  const usable = PLACEHOLDER_NAMES.has(name.toLowerCase()) ? 'there' : name;
  return FOUNDER_WELCOME_MESSAGE.replace(/\{first_name\}/g, usable);
}

/**
 * Put the welcome in the member's inbox. Call it ONLY from the paths
 * that create a brand-new member, never on login, so existing members
 * never get it.
 *
 * Idempotent: the insert is skipped when the member already has a
 * founder_welcome notification, so a retried signup callback cannot
 * double-send.
 */
async function sendWelcomeMessage(memberId, firstName) {
  try {
    if (!memberId) return { skipped: 'no_member' };
    const { rows } = await query(
      `INSERT INTO notifications (member_id, type, title, body)
       SELECT $1::uuid, $2::varchar, $3::varchar, $4::text
        WHERE NOT EXISTS (
          SELECT 1 FROM notifications WHERE member_id = $1::uuid AND type = $2::varchar
        )
       RETURNING id`,
      [memberId, FOUNDER_WELCOME_TYPE, FOUNDER_WELCOME_TITLE, welcomeText(firstName)]
    );
    return rows.length ? { sent: true } : { skipped: 'already_sent' };
  } catch (err) {
    console.warn('[welcome] could not send welcome message:', err.message);
    return { skipped: 'error' };
  }
}

module.exports = {
  sendWelcomeMessage,
  welcomeText,
  FOUNDER_WELCOME_MESSAGE,
  FOUNDER_WELCOME_TITLE,
  FOUNDER_WELCOME_TYPE,
};
