/**
 * Welcome message from the founders (founder request 15, 2026-10-03):
 * "once someone creates their account, they could receive a short
 * welcome message in the app — something warm and personal."
 *
 * Sends a real direct message, not a notification, so it lands in the
 * inbox and the member can reply to a human.
 *
 * Deliberately best-effort: signup must never fail because the welcome
 * could not be delivered. Every path swallows its error and logs.
 */
const { query } = require('../db');

const DEFAULT_TEXT =
  "Hey {first_name}, welcome to At The Park.\n\n" +
  "We started ATP because we wanted somewhere to train together, and it turned " +
  "into a community of thousands across Dubai, Al Ain, Abu Dhabi and Muscat. " +
  "You're part of that now.\n\n" +
  "Pick a session that sounds good and just turn up — you don't need to be fit, " +
  "fast or experienced. Most people arrive on their own the first time and leave " +
  "with a group.\n\n" +
  "If you have a question, reply right here. This goes to us, not a robot.\n\n" +
  "See you at the park.\nFredy & Tatiana";

/** The account the welcome is sent from: system_config.welcome_sender_id,
 *  else the longest-standing admin. Returns null if neither exists. */
async function _senderId() {
  try {
    const { rows } = await query("SELECT value FROM system_config WHERE key='welcome_sender_id'");
    const v = rows.length ? String(rows[0].value).replace(/^"|"$/g, '') : '';
    if (/^[0-9a-f-]{36}$/i.test(v)) {
      const { rows: ok } = await query('SELECT id FROM members WHERE id=$1', [v]);
      if (ok.length) return ok[0].id;
    }
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

async function _text(firstName) {
  let body = DEFAULT_TEXT;
  try {
    const { rows } = await query("SELECT value FROM system_config WHERE key='welcome_message'");
    if (rows.length) {
      const v = rows[0].value;
      const str = typeof v === 'string' ? v : (v && v.toString ? v.toString() : '');
      if (str && str.trim().length > 20) body = str.replace(/^"|"$/g, '');
    }
  } catch (_) { /* default text is fine */ }
  return body.replace(/\{first_name\}/g, firstName || 'there');
}

/**
 * Deliver the welcome DM. Safe to call more than once — a conversation
 * that already holds a message from the sender is left alone, so a
 * re-run or a double signup callback cannot double-send.
 */
async function sendWelcomeMessage(memberId, firstName) {
  try {
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
      [conversationId, sender, await _text(firstName)]
    );
    return { sent: true };
  } catch (err) {
    console.warn('[welcome] could not send welcome message:', err.message);
    return { skipped: 'error' };
  }
}

module.exports = { sendWelcomeMessage, DEFAULT_TEXT };
