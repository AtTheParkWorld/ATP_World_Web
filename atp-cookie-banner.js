/* ════════════════════════════════════════════════════════════════
 * ATP — Cookie consent banner (UAE PDPL + GDPR-style)
 * Self-contained. No dependencies. Idempotent.
 *
 * Usage: <script src="/atp-cookie-banner.js" defer></script>
 *
 * Reads/writes:  localStorage.atp_cookie_consent =
 *                  'all' | 'essential' | (unset = no decision yet)
 *
 * The banner only shows when no decision has been recorded.
 * Other code can check window.ATPConsent.has('analytics') etc.
 * ════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var KEY = 'atp_cookie_consent';
  var current = null;
  try { current = localStorage.getItem(KEY); } catch (e) {}

  window.ATPConsent = {
    get: function() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    has: function(cat) {
      var v = this.get();
      if (v === 'all') return true;
      if (v === 'essential') return cat === 'essential';
      return false;
    },
    set: function(v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      current = v;
      document.dispatchEvent(new CustomEvent('atp:consent', { detail: { value: v } }));
      var b = document.getElementById('atpCookieBanner');
      if (b) b.parentNode.removeChild(b);
    },
  };

  // No banner if user already chose
  if (current === 'all' || current === 'essential') return;

  // No banner on admin / company / accept-invite pages — those are
  // logged-in operational surfaces, banner shouldn't interrupt work.
  var p = location.pathname.toLowerCase();
  if (p.indexOf('/admin') === 0 || p.indexOf('/company') === 0 ||
      p.indexOf('/corporate/accept-invite') === 0 ||
      p === '/admin.html' || p === '/company-admin.html' ||
      p === '/corporate-accept-invite.html') return;

  function mount() {
    if (document.getElementById('atpCookieBanner')) return;

    var div = document.createElement('div');
    div.id = 'atpCookieBanner';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-label', 'Cookie consent');
    div.style.cssText = [
      'position:fixed','bottom:14px','left:14px','right:14px',
      'max-width:920px','margin:0 auto','z-index:99998',
      'background:#0a0a0a','border:1px solid rgba(168,255,0,.35)',
      'border-radius:12px','padding:18px 20px',
      'box-shadow:0 8px 30px rgba(0,0,0,.5)',
      'font-family:Inter,system-ui,-apple-system,sans-serif',
      'color:#fff','font-size:13px','line-height:1.55',
      'display:flex','gap:14px','align-items:center','flex-wrap:wrap',
    ].join(';');
    div.innerHTML =
      '<div style="flex:1;min-width:260px">' +
        '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:.04em;color:#A8FF00;margin-bottom:4px">Cookies + your data</div>' +
        'We use essential cookies to keep you signed in and analytics cookies to make ATP better. You can change your mind anytime in <a href="/privacy.html" style="color:#A8FF00;text-decoration:underline">Privacy</a>.' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button id="atpCookieEssential" style="background:transparent;border:1px solid rgba(255,255,255,.16);color:#ccc;padding:10px 16px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600">Essential only</button>' +
        '<button id="atpCookieAll" style="background:#A8FF00;border:none;color:#0a0a0a;padding:10px 18px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:700">Accept all</button>' +
      '</div>';
    document.body.appendChild(div);
    document.getElementById('atpCookieEssential').addEventListener('click', function() { window.ATPConsent.set('essential'); });
    document.getElementById('atpCookieAll').addEventListener('click', function() { window.ATPConsent.set('all'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
