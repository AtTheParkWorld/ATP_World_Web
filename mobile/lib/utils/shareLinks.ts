/**
 * Links members share OUTSIDE the app (WhatsApp, Instagram DMs, …).
 *
 * A community post is shared as its public page, /p/<id> — server-
 * rendered with a proper link preview and Open-in-app / store buttons —
 * never as the raw media file URL.
 *
 * Share links always use the brand domain (live since the 2026-10-02
 * cutover) even while WEB_BASE still points at the Render host: the
 * preview then reads atthepark.world, and it's the domain the app
 * claims for universal links. Staging builds keep their own host.
 */
import { WEB_BASE } from '@/lib/api/client';
import type { Post } from '@/lib/api/community';
import type { Session } from '@/lib/api/sessions';

const SHARE_BASE = WEB_BASE.replace(/^https:\/\/atp-world-web\.onrender\.com$/, 'https://atthepark.world');

/**
 * Session invite link, /s/<first 8 hex of the id> — the same short link
 * the daily WhatsApp message uses. It opens on the session, and WhatsApp
 * previews it with the session's name, time and place.
 */
export function sessionShareUrl(sessionId: string): string {
  const code = String(sessionId).replace(/-/g, '').slice(0, 8);
  return code.length === 8
    ? `${SHARE_BASE}/s/${code}`
    : `${SHARE_BASE}/sessions.html?session=${encodeURIComponent(String(sessionId))}`;
}

export function postShareUrl(postId: string | number): string {
  return `${SHARE_BASE}/p/${encodeURIComponent(String(postId))}`;
}

/** Trim on a word boundary; Array.from keeps emoji whole. */
function excerpt(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

/** "“<caption excerpt>” — see it on At The Park: <url>" */
export function postShareMessage(post: Pick<Post, 'id' | 'content'>): string {
  const url = postShareUrl(post.id);
  const text = excerpt(post.content || '', 100);
  return text
    ? `“${text}” — see it on At The Park: ${url}`
    : `Check this out on At The Park: ${url}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Invite to a session — any member, booked or not (founder 2026-10-09).
 * Matches the website's "Invite on WhatsApp" text.
 */
export function sessionInviteMessage(
  s: Pick<Session, 'id' | 'name' | 'scheduled_at' | 'location' | 'city_name' | 'price' | 'price_points' | 'currency_code'>,
): string {
  // Dubai wall-clock time, whatever the phone's zone (UAE has no DST).
  // Done by hand: Hermes' Intl time-zone support varies by build.
  const at = new Date(new Date(s.scheduled_at).getTime() + 4 * 3600 * 1000);
  const h = at.getUTCHours();
  const when = `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
    + ` · ${h % 12 || 12}:${String(at.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const place = s.location || s.city_name || '';
  const price = Number(s.price) > 0
    ? `🎟️ ${String(s.currency_code || 'AED').toUpperCase()} ${Number(s.price).toFixed(0)}`
    : Number(s.price_points) > 0
      ? `🎟️ ${Number(s.price_points).toLocaleString('en-US')} pts`
      : "It's free 🙌";
  return [
    `Join me at ${s.name} 💚`,
    `📅 ${when}`,
    place ? `📍 ${place}` : null,
    price,
    '',
    `Book your spot: ${sessionShareUrl(s.id)}`,
  ].filter((l) => l !== null).join('\n');
}
