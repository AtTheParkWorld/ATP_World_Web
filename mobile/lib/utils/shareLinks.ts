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

const SHARE_BASE = WEB_BASE.replace(/^https:\/\/atp-world-web\.onrender\.com$/, 'https://atthepark.world');

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
