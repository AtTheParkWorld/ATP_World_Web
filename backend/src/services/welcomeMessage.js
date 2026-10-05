/**
 * Welcome message from the founder, sent once to every new member.
 *
 * History: founder request 15 (2026-10-03) shipped this as a direct
 * message from the longest-standing admin, signed "Fredy & Tatiana".
 * Founder follow-up 2026-10-05: a short note signed by Coach Fredy, sent
 * from Fredy's own account. It stays a real direct message, not a
 * notification, so it lands in Messages and the member can reply to a
 * human. The welcome email (services/email.js → sendWelcome) carries the
 * same text, so this file is the ONE place the wording lives.
 *
 * Deliberately best-effort: signup must never fail because the welcome
 * could not be delivered. sendWelcomeMessage never throws.
 */
const { query } = require('../db');

// ── EDIT THE WELCOME HERE ─────────────────────────────────────
// Fredy's own words (2026-10-05). A {first_name} placeholder is still
// supported if it is ever added back ("there" when we have no real
// name). Blank lines split paragraphs in the email.
const FOUNDER_WELCOME_MESSAGE =
  "Welcome to ATP World!\n\n" +
  "A community where we move together, grow together, and inspire each " +
  "other to be better every day.\n\n" +
  "This is your community. This is your journey.\n\n" +
  "Never Train Alone.\n\n" +
  "Coach Fredy";

/** Email heading for the same note. */
const FOUNDER_WELCOME_TITLE = 'A message from Coach Fredy';

// Fredy's own member record (the coach account he signs in with), so a
// reply lands in his Messages. system_config.welcome_sender_id still
// overrides it; the longest-standing admin is the last resort.
const FOUNDER_MEMBER_ID = 'e0e6127d-b8d7-49f0-b3ea-ee29b02c72d8';

// Names the signup paths invent when the provider gives us none
// (Google → "Member", Apple → "Friend"). "Hey Member" reads like a bot.
const PLACEHOLDER_NAMES = new Set(['', 'member', 'friend']);

/** The welcome text personalised for one member. */
function welcomeText(firstName) {
  const name = String(firstName || '').trim();
  const usable = PLACEHOLDER_NAMES.has(name.toLowerCase()) ? 'there' : name;
  return FOUNDER_WELCOME_MESSAGE.replace(/\{first_name\}/g, usable);
}

async function _memberExists(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return false;
  const { rows } = await query(
    'SELECT id FROM members WHERE id=$1 AND COALESCE(is_banned,false) = false',
    [id]
  );
  return rows.length > 0;
}

/** The account the welcome is sent from. Returns null if none exists. */
async function _senderId() {
  try {
    const { rows } = await query("SELECT value FROM system_config WHERE key='welcome_sender_id'");
    const v = rows.length ? String(rows[0].value).replace(/^"|"$/g, '') : '';
    if (await _memberExists(v)) return v;
  } catch (_) { /* fall through */ }
  try {
    if (await _memberExists(FOUNDER_MEMBER_ID)) return FOUNDER_MEMBER_ID;
  } catch (_) { /* fall through to the admin lookup */ }
  try {
    const { rows } = await query(
      `SELECT id FROM members
        WHERE is_admin = true AND COALESCE(is_banned,false) = false
        ORDER BY joined_at ASC LIMIT 1`
    );
    return rows.length ? rows[0].id : null;
  } catch (_) { return null; }
}

/**
 * Deliver the welcome DM. Call it ONLY from the paths that create a
 * brand-new member, never on login, so existing members never get it.
 *
 * Safe to call more than once — a conversation that already holds a
 * message from the sender is left alone, so a re-run or a double signup
 * callback cannot double-send.
 */
async function sendWelcomeMessage(memberId, firstName) {
  try {
    if (!memberId) return { skipped: 'no_member' };
    const sender = await _senderId();
    if (!sender || sender === memberId) return { skipped: 'no_sender' };

    // conversations enforces CHECK (member_a < member_b), so order the ids.
    const [a, b] = [sender, memberId].sort();
    const { rows: conv } = await query(
      `INSERT INTO conversations (member_a, member_b, last_message_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (member_a, member_b) DO UPDATE SET last_message_at = NOW()
       RETURNING id`,
      [a, b]
    );
    const conversationId = conv[0].id;

    const { rows: already } = await query(
      'SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_id=$2 LIMIT 1',
      [conversationId, sender]
    );
    if (already.length) return { skipped: 'already_sent' };

    await query(
      'INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3)',
      [conversationId, sender, welcomeText(firstName)]
    );
    return { sent: true };
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
  FOUNDER_MEMBER_ID,
};
