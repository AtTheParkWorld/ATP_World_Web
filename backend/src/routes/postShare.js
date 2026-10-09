/**
 * Public share page for a community post — GET /p/:id.
 *
 * Members used to share the raw R2 media URL, so WhatsApp showed a bare
 * file link that opened the bare image. Every share action (app + web)
 * now points here: a small server-rendered page with Open Graph / Twitter
 * tags (crawlers and link previewers don't run JS) and app / store CTAs.
 *
 * PRIVACY: the page is public and unauthenticated, so it only renders a
 * post that is visible to the whole community AND safe to show outside
 * it — not deleted, author not banned / anonymised / pending deletion,
 * and no unresolved report against the post. Anything else gets the same
 * generic "isn't available" page (no content in the body or the meta
 * tags), so the response never reveals whether a hidden post exists.
 * Only the author's first name + last initial and tribe are shown — no
 * avatar, member id, member number, tags or comment text. Every page is
 * noindex: members post to the community, not to search engines.
 *
 * The DB is reached through `db.query` at call time (not a destructured
 * import) so tests can stub it.
 */
const router = require('express').Router();
const db = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IOS_STORE_URL   = 'https://apps.apple.com/app/id6796708497';
const IOS_APP_ID      = '6796708497';
const ANDROID_PACKAGE = 'world.atthepark.app';
const PLAY_STORE_URL  = 'https://play.google.com/store/apps/details?id=' + ANDROID_PACKAGE;
// 1200×630 JPEG (~100 KB) cut from og-default.png (390 KB) — WhatsApp
// silently drops preview images much over ~300 KB.
const FALLBACK_IMAGE  = '/og-share.jpg';
const BRAND_GREEN     = '#A8FF00';

function _site() {
  return (process.env.FRONTEND_URL || 'https://atthepark.world').replace(/\/+$/, '');
}

// Escapes for HTML text AND quoted attribute values.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Trim to n characters on a word boundary. Array.from counts code
// points, so an emoji is never cut in half.
function clip(text, n) {
  const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
  if (chars.length <= n) return chars.join('');
  const cut = chars.slice(0, n).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

// Media srcs are member-supplied. Only https URLs and same-site paths
// (legacy /api/cms/media/<id> refs) are ever rendered — never data:,
// javascript:, http: or protocol-relative values.
function mediaUrl(src) {
  const s = String(src || '').trim();
  if (/^\/(?!\/)/.test(s)) return _site() + s;
  if (!/^https:\/\//i.test(s)) return null;
  try { return new URL(s).href; } catch (e) { return null; }
}

function _isVideo(m) {
  return m.type === 'video' || /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(m.url);
}

function parseMedia(raw) {
  let list = raw;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const url = mediaUrl(m.src || m.url);
    if (!url) continue;
    const item = { url, type: m.type };
    item.isVideo = _isVideo(item);
    item.poster = mediaUrl(m.poster || m.thumbnail || m.thumbnail_url);
    out.push(item);
  }
  return out;
}

function platformOf(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

// Visible to the general community AND safe to show publicly. One query,
// fail closed: any DB error is the caller's generic page, never content.
async function loadVisiblePost(id) {
  const { rows } = await db.query(
    `SELECT p.id, p.content, p.media, p.likes_count, p.comments_count, p.created_at,
            m.first_name, m.last_name,
            t.name AS tribe_name, t.color AS tribe_color
       FROM posts p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN tribes t ON t.id = m.tribe_id
      WHERE p.id = $1
        AND p.is_deleted = false
        AND COALESCE(m.is_banned, false) = false
        AND m.pending_deletion_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM reports r
           WHERE r.target_type = 'post' AND r.target_id = p.id AND r.resolved = false
        )
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// ── Shared chrome ─────────────────────────────────────────────
const APPLE_SVG = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M15.5 10.5c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.8-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.8 1.1 9 .7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.3 1.2-2.6 1.2-2.6-.1-.1-2.3-.9-2.3-3.5zm-2.1-6.5c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.6.9.1 1.9-.5 2.5-1.2z"/></svg>';
const PLAY_SVG  = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M3.2 1.5L11.7 10 3.2 18.5C2.7 18.2 2.5 17.7 2.5 17V3C2.5 2.3 2.7 1.8 3.2 1.5ZM14.5 7.5L5.8 2.5 13.2 10 14.5 12.5V7.5ZM5.8 17.5L14.5 12.5V7.5L5.8 17.5ZM15.5 11L17.3 10 15.5 9 14.5 12.5Z"/></svg>';
const HEART_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
const CHAT_SVG  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';

const CSS = `
:root{--g:${BRAND_GREEN};--bk:#0a0a0a;--d:#141414;--d2:#1c1c1c;--mu:#8a8a8a;--li:#c9c9c9;--w:#fff;
--fd:'Barlow Condensed','Arial Narrow',sans-serif;--fb:'DM Sans',system-ui,-apple-system,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bk);color:var(--w);font-family:var(--fb);min-height:100vh;display:flex;flex-direction:column;
background-image:radial-gradient(120% 60% at 100% 0,rgba(168,255,0,.10),transparent 60%)}
a{color:inherit}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;max-width:560px;width:100%;margin:0 auto}
.logo{display:block;text-decoration:none}
.logo img{height:26px;width:auto;display:block}
.pill{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;color:var(--bk);background:var(--g);padding:8px 14px;border-radius:999px}
.wrap{flex:1;max-width:560px;width:100%;margin:0 auto;padding:4px 14px 32px}
.card{background:var(--d);border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden}
.author{display:flex;align-items:center;gap:12px;padding:16px}
.av{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;
font-family:var(--fd);font-weight:900;font-size:22px;color:var(--bk);background:var(--tc);box-shadow:0 0 0 2px var(--d),0 0 0 3px var(--tc)}
.name{font-weight:700;font-size:16px}
.meta{font-size:12px;color:var(--mu);margin-top:2px}
.tribe{color:var(--tc);font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:11px}
.media{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;background:#000;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.media::-webkit-scrollbar{display:none}
.mi{position:relative;flex:0 0 100%;scroll-snap-align:center;display:flex;align-items:center;justify-content:center;min-height:220px}
.mi img,.mi video{display:block;width:100%;max-height:78vh;object-fit:contain;background:#000}
.count{position:absolute;top:10px;right:10px;background:rgba(0,0,0,.6);font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px}
.caption{padding:16px 16px 4px;font-size:16px;line-height:1.55;white-space:pre-line;word-wrap:break-word;color:#f2f2f2}
.stats{display:flex;gap:18px;padding:12px 16px 16px;color:var(--mu);font-size:13px;font-weight:700}
.stats span{display:inline-flex;align-items:center;gap:6px}
.cta{text-align:center;padding:30px 6px 0}
.kick{font-family:var(--fd);font-weight:900;font-size:42px;line-height:.95;text-transform:uppercase;letter-spacing:.01em}
.kick em{font-style:normal;color:var(--g)}
.sub{color:var(--li);font-size:15px;line-height:1.55;margin:12px auto 22px;max-width:400px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;max-width:400px;margin:0 auto 12px;padding:16px 20px;border-radius:14px;
font-weight:800;font-size:14px;letter-spacing:.06em;text-transform:uppercase;text-decoration:none}
.btn-p{background:var(--g);color:var(--bk)}
.badges{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;max-width:400px;margin:0 auto 12px}
.badge{flex:1 1 170px;display:flex;align-items:center;justify-content:center;gap:10px;padding:11px 16px;border-radius:14px;text-decoration:none;
background:var(--d2);border:1px solid rgba(255,255,255,.14);text-align:left}
.badge small{display:block;font-size:10px;color:var(--li);letter-spacing:.02em}
.badge b{display:block;font-size:16px;font-weight:700;line-height:1.1}
.web{display:inline-block;margin-top:8px;color:var(--li);font-size:14px;font-weight:600;text-decoration:none;padding:8px}
.web:hover,.badge:hover{border-color:var(--g);color:var(--w)}
.gone{padding:40px 22px;text-align:center}
.gone .kick{font-size:38px}
.sess{padding:22px 20px 20px;border-top:4px solid var(--tc)}
.sess .tribe{display:block;margin-bottom:8px}
.sess h1{font-family:var(--fd);font-weight:900;font-size:40px;line-height:.95;text-transform:uppercase;letter-spacing:.01em;margin-bottom:16px}
.facts{list-style:none;display:grid;gap:9px;font-size:15px;color:var(--li)}
.facts b{color:var(--w);font-weight:700}
.sess .btn{margin:22px 0 0;max-width:none}
.foot{text-align:center;color:var(--mu);font-size:12px;padding:28px 16px 34px;line-height:1.7}
.foot a{color:var(--mu)}
`;

function _storeBadges(platform) {
  const ios  = `<a class="badge" href="${esc(IOS_STORE_URL)}" rel="noopener">${APPLE_SVG}<span><small>Download on the</small><b>App Store</b></span></a>`;
  const play = `<a class="badge" href="${esc(PLAY_STORE_URL)}" rel="noopener">${PLAY_SVG}<span><small>Get it on</small><b>Google Play</b></span></a>`;
  if (platform === 'ios') return ios;
  if (platform === 'android') return play;
  return ios + play;
}

// Custom-scheme deep link into app/community/post/[id].tsx. Android gets
// an intent:// URL, which opens the app when installed and otherwise
// falls back to the Play listing — no JS, no redirect for crawlers.
function _openInAppHref(platform, postId) {
  const path = 'community/post/' + postId;
  if (platform === 'android') {
    return 'intent://' + path + '#Intent;scheme=atp;package=' + ANDROID_PACKAGE +
      ';S.browser_fallback_url=' + encodeURIComponent(PLAY_STORE_URL) + ';end';
  }
  if (platform === 'ios') return 'atp://' + path;
  return null;   // desktop — no app to open
}

function _page({ title, description, image, imageAlt, canonical, appArgument, body }) {
  const site = _site();
  const img = image || site + FALLBACK_IMAGE;
  const isFallback = img === site + FALLBACK_IMAGE;
  const meta = [
    `<meta name="description" content="${esc(description)}">`,
    '<meta name="robots" content="noindex">',
    '<meta name="theme-color" content="#0a0a0a">',
    `<meta name="apple-itunes-app" content="app-id=${IOS_APP_ID}${appArgument ? ', app-argument=' + esc(appArgument) : ''}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="At The Park">',
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:secure_url" content="${esc(img)}">`,
    ...(isFallback ? [
      '<meta property="og:image:type" content="image/jpeg">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
    ] : []),
    `<meta property="og:image:alt" content="${esc(imageAlt || 'At The Park — never train alone')}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
  ].join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
${meta}
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800;900&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <a class="logo" href="/" aria-label="At The Park home"><picture><source srcset="/atp-logo-transparent.webp" type="image/webp"><img src="/atp-logo-transparent.png" alt="At The Park" width="97" height="26"></picture></a>
  <a class="pill" href="/app">Get the app</a>
</header>
<main class="wrap">
${body}
</main>
<footer class="foot">At The Park · Free outdoor fitness across the UAE<br><a href="/">atthepark.world</a> · <a href="/privacy">Privacy</a></footer>
</body>
</html>`;
}

function _ctaBlock(platform, postId, firstName) {
  const open = postId ? _openInAppHref(platform, postId) : null;
  const who = firstName ? esc(firstName) + ' and the crew' : 'the crew';
  return `<section class="cta">
  <h2 class="kick">Never train<br><em>alone.</em></h2>
  <p class="sub">Like, comment and train with ${who} — free outdoor sessions across the UAE, all in the ATP app.</p>
  ${open ? `<a class="btn btn-p" href="${esc(open)}">Open in the app</a>` : ''}
  <div class="badges">${_storeBadges(platform)}</div>
  <a class="web" href="/community">See the community on the web →</a>
</section>`;
}

function renderPostPage(post, { ua = '' } = {}) {
  const site = _site();
  const platform = platformOf(ua);
  const id = String(post.id);
  const canonical = site + '/p/' + id;
  const first = String(post.first_name || '').trim() || 'An ATP member';
  const lastInitial = Array.from(String(post.last_name || '').trim())[0] || '';
  const display = lastInitial ? first + ' ' + lastInitial.toUpperCase() + '.' : first;
  const tribeColor = /^#[0-9a-f]{3,8}$/i.test(String(post.tribe_color || '')) ? post.tribe_color : BRAND_GREEN;
  const media = parseMedia(post.media);
  const lead = media[0] || null;
  const text = String(post.content || '').trim();

  const kind = lead ? (lead.isVideo ? 'video' : 'photo') : 'post';
  const description = text
    ? clip(text, 180)
    : `A ${kind} from the At The Park community — free outdoor training across the UAE. Never train alone.`;

  // og:image — the post's own photo (or a video's poster) for every
  // previewer EXCEPT WhatsApp, which silently drops images over ~300 KB.
  // Member photos are full-size phone uploads (1–4 MB), so WhatsApp gets
  // the light branded card until a thumbnail step exists.
  const isWhatsApp = /WhatsApp/i.test(ua);
  let image = null;
  if (lead && !isWhatsApp) image = lead.isVideo ? lead.poster : lead.url;

  const date = post.created_at
    ? new Date(post.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })
    : '';

  const mediaHtml = media.length ? `<div class="media">${media.map((m, i) => {
    const count = media.length > 1 ? `<span class="count">${i + 1}/${media.length}</span>` : '';
    if (m.isVideo) {
      // #t=0.1 makes iOS Safari paint the first frame instead of black.
      const src = m.url.includes('#') ? m.url : m.url + '#t=0.1';
      return `<div class="mi">${count}<video src="${esc(src)}" controls playsinline preload="metadata"${m.poster ? ` poster="${esc(m.poster)}"` : ''}></video></div>`;
    }
    return `<div class="mi">${count}<img src="${esc(m.url)}" alt="${esc('Photo shared by ' + first)}"${i ? ' loading="lazy"' : ''} decoding="async"></div>`;
  }).join('')}</div>` : '';

  const body = `<article class="card" style="--tc:${tribeColor}">
  <div class="author">
    <div class="av" aria-hidden="true">${esc((Array.from(first)[0] || 'A').toUpperCase())}</div>
    <div>
      <div class="name">${esc(display)}</div>
      <div class="meta">${post.tribe_name ? `<span class="tribe">${esc(post.tribe_name)} tribe</span> · ` : ''}${esc(date)}</div>
    </div>
  </div>
  ${mediaHtml}
  ${text ? `<p class="caption">${esc(text)}</p>` : ''}
  <div class="stats">
    <span>${HEART_SVG}${Number(post.likes_count) || 0}</span>
    <span>${CHAT_SVG}${Number(post.comments_count) || 0}</span>
  </div>
</article>
${_ctaBlock(platform, id, first)}`;

  return _page({
    title: first + ' on At The Park',
    description,
    image,
    imageAlt: image ? `${kind === 'video' ? 'Video' : 'Photo'} shared by ${first} on At The Park` : null,
    canonical,
    appArgument: canonical,
    body,
  });
}

// Generic page for missing / hidden / malformed ids. Deliberately
// identical whatever the reason, and carries no post data at all.
function renderUnavailablePage({ ua = '' } = {}) {
  const platform = platformOf(ua);
  const body = `<article class="card gone">
  <h1 class="kick">This post isn't<br><em>available.</em></h1>
  <p class="sub">It may have been removed, or it's only visible inside the ATP community.</p>
</article>
${_ctaBlock(platform, null, null)}`;
  return _page({
    title: 'At The Park',
    description: "The UAE's free outdoor fitness community. Never train alone.",
    image: null,
    canonical: _site() + '/',
    appArgument: null,
    body,
  });
}

// ── Session invites — GET /s/:code ─────────────────────────────
// Founder 2026-10-09: members can now invite friends to any session.
// The invite link is /s/<first 8 hex of the session id>. People are sent
// straight on to the session on sessions.html (302, as before); link
// previewers (WhatsApp, iMessage, Telegram…) don't follow it there, so
// they get a small page whose Open Graph tags carry the session's name,
// time and place. Private company sessions and past / cancelled ones
// only ever show the generic At The Park card.
const PREVIEW_BOT_RE = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Applebot|Googlebot|bingbot|Pinterest|redditbot|Embedly|Iframely|Viber|Snapchat|vkShare/i;

async function loadInviteSession(id) {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.scheduled_at, s.location, s.session_type, s.price,
            s.price_points, s.currency_code,
            t.name AS tribe_name, t.color AS tribe_color,
            c.name AS city_name,
            TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS coach_name
       FROM sessions s
       LEFT JOIN tribes t  ON t.id = s.tribe_id
       LEFT JOIN cities c  ON c.id = s.city_id
       LEFT JOIN members m ON m.id = s.coach_id
      WHERE s.id = $1
        AND s.status = 'upcoming'
        AND COALESCE(s.is_corporate_only, false) = false
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function _sessionPrice(s) {
  if (Number(s.price) > 0) return `${String(s.currency_code || 'AED').toUpperCase()} ${Number(s.price).toFixed(0)}`;
  if (Number(s.price_points) > 0) return `${Number(s.price_points).toLocaleString('en-US')} pts`;
  return 'Free';
}

function renderSessionPage(session, { code = '' } = {}) {
  const site = _site();
  const target = session
    ? `${site}/sessions.html?session=${encodeURIComponent(session.id)}`
    : `${site}/sessions.html`;
  const canonical = code ? `${site}/s/${code}` : target;
  if (!session) {
    return _page({
      title: 'At The Park sessions',
      description: "Free outdoor training across the UAE — find a session and book your spot. Never train alone.",
      image: null,
      canonical,
      appArgument: null,
      body: `<article class="card gone">
  <h1 class="kick">Find your<br><em>next session.</em></h1>
  <p class="sub">Free outdoor training across the UAE.</p>
  <a class="btn btn-p" href="${esc(target)}">See all sessions</a>
</article>`,
    });
  }
  const at = new Date(session.scheduled_at);
  const day = at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
  const dayLong = at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' });
  const place = [session.location, session.city_name].filter(Boolean)
    .filter((v, i, a) => i === 0 || !String(a[0]).toLowerCase().includes(String(v).toLowerCase()))
    .join(', ');
  const coach = String(session.coach_name || '').trim();
  const price = _sessionPrice(session);
  const tribeColor = /^#[0-9a-f]{3,8}$/i.test(String(session.tribe_color || '')) ? session.tribe_color : BRAND_GREEN;
  const description = [place ? `📍 ${place}` : null, coach ? `Coach ${coach}` : null, price]
    .filter(Boolean).join(' · ') + ' — book your spot. Never train alone.';
  const body = `<article class="card sess" style="--tc:${tribeColor}">
  ${session.tribe_name ? `<span class="tribe">${esc(session.tribe_name)} tribe</span>` : ''}
  <h1>${esc(session.name)}</h1>
  <ul class="facts">
    <li>📅 <b>${esc(dayLong)}</b> · ${esc(time)}</li>
    ${place ? `<li>📍 ${esc(place)}</li>` : ''}
    ${coach ? `<li>🎽 Coach ${esc(coach)}</li>` : ''}
    <li>🎟️ ${esc(price)}</li>
  </ul>
  <a class="btn btn-p" href="${esc(target)}">Book your spot</a>
</article>`;
  return _page({
    title: `${session.name} · ${day}, ${time}`,
    description: clip(description, 200),
    image: null,
    canonical,
    appArgument: null,
    body,
  });
}

router.get('/s/:code', async (req, res) => {
  const ua = String(req.headers['user-agent'] || '');
  const code = String(req.params.code || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 32);
  const isPreview = PREVIEW_BOT_RE.test(ua);
  let id = null;
  try {
    id = await require('../services/whatsappDigest').resolveShortCode(code);
  } catch (e) {
    console.warn('[share] session code lookup failed:', e.message);
  }
  if (!isPreview) {
    return res.redirect(302, id ? `/sessions.html?session=${encodeURIComponent(id)}` : '/sessions.html');
  }
  let session = null;
  if (id) {
    try { session = await loadInviteSession(id); } catch (e) {
      console.warn('[share] session lookup failed:', e.message);
    }
  }
  res.vary('User-Agent');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.type('html');
  return res.status(200).send(renderSessionPage(session, { code }));
});

router.get('/p/:id', async (req, res) => {
  const ua = String(req.headers['user-agent'] || '');
  // Output depends on the UA (store badges, WhatsApp image) — and no
  // caching beyond revalidation, so a deletion or ban applies at once.
  res.vary('User-Agent');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.type('html');

  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) return res.status(404).send(renderUnavailablePage({ ua }));
  let post;
  try {
    post = await loadVisiblePost(id);
  } catch (e) {
    console.warn('[share] post lookup failed:', e.message);
    return res.status(503).send(renderUnavailablePage({ ua }));
  }
  if (!post) return res.status(404).send(renderUnavailablePage({ ua }));
  return res.status(200).send(renderPostPage(post, { ua }));
});

module.exports = router;
module.exports.renderPostPage = renderPostPage;
module.exports.renderUnavailablePage = renderUnavailablePage;
module.exports.renderSessionPage = renderSessionPage;
module.exports._internal = { esc, clip, mediaUrl, parseMedia, platformOf };
