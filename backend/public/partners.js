/* Partner brands on ATP sessions + 30x30 challenges (founder 2026-10-21:
 * "add Reebok logo everywhere on our website and app we can explore
 * visibility"). One list, used by sessions.html, the 30x30 landing and
 * hub-challenges.js; the app mirrors it in mobile/lib/partners.tsx.
 *
 * A session or challenge belongs to a partner when its name (or the
 * admin's "Powered by" sponsor name) mentions the brand. A session's own
 * admin sponsor LOGO still wins wherever pages already show one.
 *
 * Reebok brand guidelines (2022): official files only, never recoloured,
 * stretched, outlined or given effects — these are their PNGs trimmed of
 * padding, nothing else. Vector Red on light backgrounds, Classic White
 * on dark ones. Clear space around the mark; top-right / bottom-right
 * placement where there is a choice. Logos link to the partner's site
 * (founder 2026-10-21), except where the logo sits inside something that
 * is itself clickable (a calendar slot, a session row).
 */
(function () {
  if (window.ATPPartners) return;
  var IMG = '/img/partners/';
  var LIST = [{
    key: 'reebok',
    name: 'Reebok',
    re: /reebok/i,
    url: 'https://www.reebok.ae/',
    files: { lockup: 'reebok-lockup', wordmark: 'reebok-wordmark', vector: 'reebok-vector' },
    // Trademark line from Reebok's guidelines (marketing material).
    legal: 'Reebok® and the Vector logo are registered trademarks of Reebok International Limited.'
  }];
  function text(x) {
    if (!x) return '';
    if (typeof x === 'string') return x;
    return [x.name, x.n, x.session_name, x.sponsor_name].filter(Boolean).join(' ');
  }
  function match(x) {
    var t = text(x);
    if (!t) return null;
    for (var i = 0; i < LIST.length; i++) if (LIST[i].re.test(t)) return LIST[i];
    return null;
  }
  // kind: 'lockup' | 'wordmark' | 'vector'; bg: 'light' (red) | 'dark' (Classic White)
  function src(p, kind, bg) {
    return IMG + p.files[kind || 'lockup'] + '-' + (bg === 'dark' ? 'white' : 'red') + '.png';
  }
  // <a> around a logo — new tab, marked as a sponsored link.
  function link(p, inner, cls) {
    return '<a href="' + p.url + '" target="_blank" rel="noopener sponsored"' + (cls ? ' class="' + cls + '"' : '') +
      ' aria-label="' + p.name + ' (opens in a new tab)" onclick="event.stopPropagation()">' + inner + '</a>';
  }
  window.ATPPartners = { list: LIST, match: match, src: src, link: link };
})();
