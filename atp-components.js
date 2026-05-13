/* ════════════════════════════════════════════════════════════════
 * ATP COMPONENTS v1
 * Shared site nav + toast API. Auto-mounts on DOMContentLoaded.
 *
 * Pages opt in by:
 *   1. Including <script src="/atp-components.js"></script> in <body>
 *   2. Adding <div id="atp-nav-host" data-active="sessions"></div> where
 *      the nav should appear.
 *   3. (optional) Setting window.ATP_NAV_EXTRAS = ['<html>...</html>']
 *      BEFORE this script runs to inject page-specific buttons (e.g.
 *      a cart icon on the store page).
 *
 * Re-renders the auth state (Log in/Join free vs avatar) automatically
 * on `atp:login` and `atp:logout` events fired by atp.js.
 * ════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  var NAV_LINKS = [
    { key: 'blog',      label: 'Blog',         href: 'blog.html' },
    { key: 'sessions',  label: 'Sessions',     href: 'sessions.html' },
    { key: 'stream',    label: 'Live',         href: 'stream.html' },
    { key: 'community', label: 'Community',    href: 'community.html' },
    { key: 'store',     label: 'Store',        href: 'store.html' },
    { key: 'plans',     label: 'Plans',        href: 'plans.html' },
    { key: 'partners',  label: 'Partners',     href: 'index.html#partners' },
    { key: 'coaches',   label: 'Our coaches',  href: 'coaches.html' },
  ];

  var LOGO_SRC = '/atp-logo-transparent.webp';

  /* ── HTML helpers ──────────────────────────────────────────── */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function navMarkup(activeKey, extrasHtml) {
    var links = NAV_LINKS.map(function(l) {
      var cls = l.key === activeKey ? ' class="active"' : '';
      return '<li><a href="' + l.href + '"' + cls + '>' + l.label + '</a></li>';
    }).join('');

    return (
      '<nav id="nav">' +
        '<div class="nav-inner">' +
          '<a href="index.html" class="nav-logo" aria-label="At The Park">' +
            '<img src="' + LOGO_SRC + '" alt="At The Park" style="height:32px;width:auto;display:block">' +
          '</a>' +
          '<ul class="nav-links">' + links + '</ul>' +
          '<div class="nav-actions" id="atp-nav-actions">' +
            (extrasHtml || '') +
            authMarkup() +
          '</div>' +
          '<button type="button" class="hamburger" aria-label="Open menu" aria-expanded="false">' +
            '<span></span><span></span><span></span>' +
          '</button>' +
        '</div>' +
      '</nav>'
    );
  }

  function authMarkup() {
    var loggedIn = !!(window.ATP && window.ATP.isLoggedIn && window.ATP.isLoggedIn());
    if (!loggedIn) {
      // Anchors (not buttons) so right-click \u2192 "Open in new tab" works and
      // links survive even if JS handlers fail to attach. /join.html
      // serves both signup and login via ?mode=login.
      var navAnchorStyle = 'display:inline-flex;align-items:center;text-decoration:none';
      return (
        '<a class="btn-ghost" href="/join?mode=login" style="' + navAnchorStyle + '">Log in</a>' +
        '<a class="btn-primary" href="/join" style="' + navAnchorStyle + '">Join free \u2192</a>'
      );
    }
    var u = (window.ATP.getUser && window.ATP.getUser()) || {};
    var first = u.first_name || (u.firstName) || 'Member';
    var last  = u.last_name  || (u.lastName)  || '';
    var initials = (first[0] || '?') + ((last[0]) || '');
    return (
      '<a href="profile.html" class="nav-user" title="My profile" style="text-decoration:none;color:inherit">' +
        '<div class="nav-avatar" title="' + escapeHtml(first + ' ' + last) + '">' + escapeHtml(initials.toUpperCase()) + '</div>' +
        '<div class="nav-user-name">' + escapeHtml(first) + '</div>' +
      '</a>' +
      '<button class="nav-logout" data-atp-action="logout">Log out</button>'
    );
  }

  /* ── Nav mount + re-render ─────────────────────────────────── */
  function mountNav() {
    var host = document.getElementById('atp-nav-host');
    if (!host) return;
    var active = host.getAttribute('data-active') || '';
    var extras = Array.isArray(window.ATP_NAV_EXTRAS)
      ? window.ATP_NAV_EXTRAS.join('')
      : (window.ATP_NAV_EXTRAS || '');
    host.innerHTML = navMarkup(active, extras);
  }

  function rerenderAuth() {
    var actions = document.getElementById('atp-nav-actions');
    if (!actions) { mountNav(); return; }
    var extras = Array.isArray(window.ATP_NAV_EXTRAS)
      ? window.ATP_NAV_EXTRAS.join('')
      : (window.ATP_NAV_EXTRAS || '');
    actions.innerHTML = (extras || '') + authMarkup();
  }

  /* ── Delegated handlers for auth buttons ───────────────────── */
  function handleNavClick(e) {
    var btn = e.target.closest('[data-atp-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-atp-action');
    if (action === 'login' || action === 'signup') {
      // Prefer the page-local auth modal (richer UX), else fall back to shared
      if (typeof window.openAuth === 'function') window.openAuth(action);
      else openAuthModal(action);
    } else if (action === 'logout') {
      if (typeof window.logOut === 'function') {
        window.logOut();
      } else if (window.ATP && window.ATP.auth && window.ATP.auth.logout) {
        window.ATP.auth.logout().finally(function() { window.location.href = 'index.html'; });
      }
    }
  }

  /* ── Toast API ─────────────────────────────────────────────── */
  function ensureToastHost() {
    var host = document.getElementById('atp-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'atp-toast-host';
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, kind) {
    var host = ensureToastHost();
    var el = document.createElement('div');
    el.className = 'atp-toast' + (kind ? ' atp-toast--' + kind : '');
    el.textContent = String(message || '');
    host.appendChild(el);
    setTimeout(function() {
      el.style.transition = 'opacity 200ms';
      el.style.opacity = '0';
      setTimeout(function() { el.remove(); }, 220);
    }, 2800);
  }

  /* ── Form validation helpers ───────────────────────────────────
   * Standardised pattern: aria-invalid + .atp-form-error sibling.
   * Pages call ATPComponents.fieldError(input, msg) instead of inline alerts.
   * ──────────────────────────────────────────────────────────── */

  function _errorEl(input) {
    var host = input.closest('.atp-field') || input.parentElement;
    if (!host) return null;
    var err = host.querySelector('.atp-form-error');
    if (!err) {
      err = document.createElement('div');
      err.className = 'atp-form-error';
      err.setAttribute('aria-live', 'polite');
      host.appendChild(err);
    }
    return err;
  }

  function fieldError(input, message) {
    if (typeof input === 'string') input = document.getElementById(input);
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    var err = _errorEl(input);
    if (err) err.textContent = String(message || 'Required');
  }

  function fieldClear(input) {
    if (typeof input === 'string') input = document.getElementById(input);
    if (!input) return;
    input.removeAttribute('aria-invalid');
    var host = input.closest('.atp-field') || input.parentElement;
    var err = host && host.querySelector('.atp-form-error');
    if (err) err.textContent = '';
  }

  function clearForm(formOrSelector) {
    var form = typeof formOrSelector === 'string'
      ? document.querySelector(formOrSelector)
      : formOrSelector;
    if (!form) return;
    Array.prototype.forEach.call(
      form.querySelectorAll('[aria-invalid="true"]'),
      function(el) { el.removeAttribute('aria-invalid'); }
    );
    Array.prototype.forEach.call(
      form.querySelectorAll('.atp-form-error'),
      function(el) { el.textContent = ''; }
    );
  }

  /* ── Auth-modal lazy mounter ───────────────────────────────────
   * Opt-in: pages can call ATPComponents.openAuthModal('login'|'signup').
   * Builds a single modal on first call, reuses thereafter. Talks to
   * window.ATP for the actual register/login + dispatches atp:login on
   * success so the shared nav + any listeners re-render.
   * ──────────────────────────────────────────────────────────── */

  var _authBuilt = false;
  function ensureAuthModal() {
    if (_authBuilt) return document.getElementById('atp-auth-modal');
    var wrap = document.createElement('div');
    wrap.id = 'atp-auth-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);backdrop-filter:blur(10px);z-index:' +
      (getComputedStyle(document.documentElement).getPropertyValue('--atp-z-modal') || 500) +
      ';display:none;align-items:center;justify-content:center;padding:20px';
    wrap.innerHTML =
      '<div style="background:#0d0d0d;border:1px solid var(--atp-line-strong);border-radius:var(--atp-radius-lg);padding:32px;max-width:420px;width:100%;position:relative">' +
        '<button type="button" data-atp-action="auth-close" aria-label="Close" style="position:absolute;top:14px;right:14px;background:none;border:none;color:var(--atp-fg-muted);font-size:24px;cursor:pointer;line-height:1">×</button>' +
        '<h2 id="atp-auth-title" style="margin:0 0 8px;font-size:var(--atp-text-2xl)">Join free</h2>' +
        '<p id="atp-auth-sub" style="margin:0 0 22px;color:var(--atp-fg-muted);font-size:var(--atp-text-base)">Become an ATP member to book sessions.</p>' +
        '<div id="atp-auth-banner" class="atp-form-error" style="margin-bottom:14px;display:none"></div>' +
        '<form id="atp-auth-form" novalidate>' +
          '<div id="atp-auth-signup-fields">' +
            '<div class="atp-field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
              '<input class="atp-input" id="atpaFirst" placeholder="First name" autocomplete="given-name">' +
              '<input class="atp-input" id="atpaLast"  placeholder="Last name"  autocomplete="family-name">' +
            '</div>' +
          '</div>' +
          '<div class="atp-field" style="margin-bottom:12px">' +
            '<input class="atp-input" id="atpaEmail" type="email" placeholder="you@email.com" autocomplete="email">' +
          '</div>' +
          '<div class="atp-field" style="margin-bottom:18px">' +
            '<input class="atp-input" id="atpaPass" type="password" placeholder="Password (min 8)" autocomplete="current-password">' +
          '</div>' +
          '<button type="submit" class="atp-btn atp-btn--primary atp-btn--lg" id="atpaSubmit" style="width:100%">Join free</button>' +
        '</form>' +
        '<div style="margin-top:16px;text-align:center;font-size:var(--atp-text-sm);color:var(--atp-fg-muted)">' +
          '<span id="atp-auth-switch-text">Already a member?</span> ' +
          '<button type="button" data-atp-action="auth-toggle" style="background:none;border:none;color:var(--atp-green);cursor:pointer;font-weight:600;padding:0">Log in</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    // Close on backdrop click
    wrap.addEventListener('click', function(e) {
      if (e.target === wrap) closeAuthModal();
    });
    // Submit handler
    wrap.querySelector('#atp-auth-form').addEventListener('submit', function(e) {
      e.preventDefault();
      submitAuth();
    });

    _authBuilt = true;
    return wrap;
  }

  var _authMode = 'signup';
  var _authReturnFocus = null;   // element that opened the modal (focus is restored on close)
  var _authTrapHandler = null;   // bound keydown handler for focus trap

  function _focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]),' +
      ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function(el) {
      return el.offsetParent !== null; // visible
    });
  }

  function _installFocusTrap(modal) {
    _authTrapHandler = function(e) {
      if (e.key !== 'Tab') return;
      var f = _focusables(modal);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', _authTrapHandler);
  }

  function _removeFocusTrap() {
    if (_authTrapHandler) {
      document.removeEventListener('keydown', _authTrapHandler);
      _authTrapHandler = null;
    }
  }

  function openAuthModal(mode) {
    _authMode = mode === 'login' ? 'login' : 'signup';
    _authReturnFocus = document.activeElement; // remember opener so we can restore focus on close
    var modal = ensureAuthModal();
    document.getElementById('atp-auth-title').textContent = _authMode === 'login' ? 'Log in' : 'Join free';
    document.getElementById('atp-auth-sub').textContent =
      _authMode === 'login' ? 'Welcome back. Enter your email and password.' : 'Become an ATP member to book sessions.';
    document.getElementById('atp-auth-signup-fields').style.display = _authMode === 'login' ? 'none' : 'block';
    document.getElementById('atp-auth-switch-text').textContent =
      _authMode === 'login' ? 'New to ATP?' : 'Already a member?';
    document.querySelector('[data-atp-action="auth-toggle"]').textContent =
      _authMode === 'login' ? 'Join free' : 'Log in';
    document.getElementById('atpaSubmit').textContent = _authMode === 'login' ? 'Log in' : 'Join free';
    var banner = document.getElementById('atp-auth-banner');
    banner.style.display = 'none';
    banner.textContent = '';
    clearForm('#atp-auth-form');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // lock background scroll
    _installFocusTrap(modal);
    setTimeout(function() {
      var firstField = _authMode === 'login'
        ? document.getElementById('atpaEmail')
        : document.getElementById('atpaFirst');
      firstField && firstField.focus();
    }, 50);
  }

  function closeAuthModal() {
    var m = document.getElementById('atp-auth-modal');
    if (!m || m.style.display === 'none') return;
    m.style.display = 'none';
    document.body.style.overflow = '';
    _removeFocusTrap();
    // Restore focus to whatever opened the modal — keyboard users land back where they were
    if (_authReturnFocus && typeof _authReturnFocus.focus === 'function') {
      try { _authReturnFocus.focus(); } catch(e) {}
    }
    _authReturnFocus = null;
  }

  function _showBanner(msg) {
    var b = document.getElementById('atp-auth-banner');
    b.textContent = msg;
    b.style.display = 'block';
  }

  function submitAuth() {
    if (!window.ATP || !window.ATP.auth) {
      _showBanner('API client not loaded.');
      return;
    }
    clearForm('#atp-auth-form');

    var email = document.getElementById('atpaEmail').value.trim();
    var pass  = document.getElementById('atpaPass').value;

    var ok = true;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fieldError('atpaEmail', 'Enter a valid email.');
      ok = false;
    }
    if (!pass || pass.length < 8) {
      fieldError('atpaPass', _authMode === 'login' ? 'Enter your password.' : 'At least 8 characters.');
      ok = false;
    }

    var first, last;
    if (_authMode === 'signup') {
      first = document.getElementById('atpaFirst').value.trim();
      last  = document.getElementById('atpaLast').value.trim();
      if (!first) { fieldError('atpaFirst', 'Required'); ok = false; }
      if (!last)  { fieldError('atpaLast',  'Required'); ok = false; }
    }
    if (!ok) return;

    var submit = document.getElementById('atpaSubmit');
    submit.disabled = true;
    submit.textContent = _authMode === 'login' ? 'Logging in…' : 'Creating account…';

    var promise = _authMode === 'login'
      ? window.ATP.auth.login(email, pass)
      : window.ATP.auth.register({ first_name: first, last_name: last, email: email, password: pass });

    promise.then(function(data) {
      submit.disabled = false;
      submit.textContent = _authMode === 'login' ? 'Log in' : 'Join free';
      if (data.error || !data.token) {
        _showBanner(data.error || 'Something went wrong. Please try again.');
        return;
      }
      toast(_authMode === 'login' ? 'Welcome back!' : 'Welcome to ATP!', 'success');
      closeAuthModal();
      // atp.js already dispatched atp:login
    }).catch(function() {
      submit.disabled = false;
      submit.textContent = _authMode === 'login' ? 'Log in' : 'Join free';
      _showBanner('Connection error. Please check your internet.');
    });
  }

  /* ── Announcement ticker (Theme 5 / #34, #35) ──────────────────
   * Continuous marquee. All active announcements concatenated into a
   * single horizontal strip that scrolls right → left. The strip is
   * duplicated end-to-end so the loop is seamless. Pauses on hover so
   * users can actually read promo codes / event details.
   * Sticky at top so it's visible across the whole page without being
   * fixed in the viewport's middle (which would obscure content).
   * ──────────────────────────────────────────────────────────── */

  function ensureTickerStyles() {
    if (document.getElementById('atp-ticker-styles')) return;
    var st = document.createElement('style');
    st.id = 'atp-ticker-styles';
    st.textContent = [
      // Ticker sits BELOW the nav (nav is fixed at top:0, height var(--nav-h)
      // which defaults to 68px). z-index keeps it above page content but
      // below modals (which use z-index 500+).
      '#atp-ticker-host{',
      '  position:fixed;top:var(--nav-h,68px);left:0;right:0;z-index:90;height:44px;display:none;',
      '  background:linear-gradient(90deg,#0a0a0a 0%,#0d1a08 50%,#0a0a0a 100%);',
      '  border-bottom:2px solid var(--atp-green,#7AC231);',
      '  overflow:hidden;align-items:center;',
      '  box-shadow:0 4px 16px rgba(0,0,0,.4);',
      '}',
      '#atp-ticker-host.atp-ticker-on{display:flex}',
      // When the ticker is on, push body content down by the ticker height
      // so it doesn\'t hide the first 44px under the marquee. Each page\'s
      // wrap already accounts for var(--nav-h); this stacks on top of that.
      'body.atp-ticker-active{padding-top:44px}',
      '#atp-ticker-host::before,#atp-ticker-host::after{',
      '  content:"";position:absolute;top:0;bottom:0;width:64px;z-index:2;pointer-events:none;',
      '}',
      '#atp-ticker-host::before{left:0;background:linear-gradient(90deg,#0a0a0a,transparent)}',
      '#atp-ticker-host::after{right:0;background:linear-gradient(-90deg,#0a0a0a,transparent)}',
      // 40s = ~33% faster than the previous 60s. Hover still pauses.
      '.atp-ticker-track{display:flex;flex-shrink:0;align-items:center;gap:64px;',
      '  animation:atp-ticker-scroll 40s linear infinite;padding-left:32px}',
      '#atp-ticker-host:hover .atp-ticker-track{animation-play-state:paused}',
      '.atp-ticker-item{display:inline-flex;align-items:center;gap:10px;',
      '  font-size:14px;font-weight:600;letter-spacing:.02em;color:#fff;',
      '  white-space:nowrap;flex-shrink:0}',
      '.atp-ticker-item .badge{font-size:10px;font-weight:800;letter-spacing:.1em;',
      '  text-transform:uppercase;padding:3px 9px;border-radius:20px;',
      '  background:rgba(122,194,49,.18);color:var(--atp-green,#7AC231);',
      '  border:1px solid rgba(122,194,49,.4)}',
      '.atp-ticker-item.kind-promo .badge{background:rgba(255,196,0,.15);color:#ffc400;border-color:rgba(255,196,0,.4)}',
      '.atp-ticker-item.kind-event .badge{background:rgba(96,165,250,.15);color:#60a5fa;border-color:rgba(96,165,250,.4)}',
      '.atp-ticker-item a{color:#fff;text-decoration:none;border-bottom:1px dashed rgba(255,255,255,.3)}',
      '.atp-ticker-item a:hover{border-bottom-color:var(--atp-green,#7AC231);color:var(--atp-green,#7AC231)}',
      '.atp-ticker-sep{color:rgba(255,255,255,.25);font-weight:700;flex-shrink:0}',
      '@keyframes atp-ticker-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
      '@media (prefers-reduced-motion: reduce){',
      '  .atp-ticker-track{animation-duration:240s}',  // still moves, but slowly
      '}',
    ].join('');
    document.head.appendChild(st);
  }

  function ensureTickerHost() {
    var host = document.getElementById('atp-ticker-host');
    if (!host) {
      ensureTickerStyles();
      host = document.createElement('div');
      host.id = 'atp-ticker-host';
      host.setAttribute('role', 'marquee');
      host.setAttribute('aria-label', 'ATP announcements');
      document.body.insertBefore(host, document.body.firstChild);
    }
    return host;
  }

  function tickerItemMarkup(item) {
    var label = (item.kind === 'event') ? 'Event'
              : (item.kind === 'promo') ? 'Promo'
              : 'News';
    var icon  = (item.kind === 'event') ? '📣'
              : (item.kind === 'promo') ? '🎁'
              : 'ℹ️';
    var inner = '<span class="badge">' + icon + ' ' + label + '</span>' +
                '<span>' + escapeHtml(item.message) + '</span>';
    if (item.link_url) {
      inner += ' <a href="' + escapeHtml(item.link_url) + '">More →</a>';
    }
    return '<div class="atp-ticker-item kind-' + (item.kind || 'info') + '">' + inner + '</div>';
  }

  function renderTickerStrip(items) {
    if (!items.length) return '';
    var sep = '<span class="atp-ticker-sep">•</span>';
    var pieces = items.map(tickerItemMarkup).join(sep);
    // Duplicate the strip end-to-end so the marquee loops without a gap
    return '<div class="atp-ticker-track">' + pieces + sep + pieces + '</div>';
  }

  var _tickerItems = [];

  function loadTicker() {
    fetch('/api/announcements')
      .then(function(r){ return r.ok ? r.json() : { announcements: [] }; })
      .then(function(data){
        _tickerItems = (data && data.announcements) || [];
        var host = document.getElementById('atp-ticker-host');
        if (!_tickerItems.length) {
          // No active announcements → hide ticker + restore default body padding.
          if (host) host.classList.remove('atp-ticker-on');
          document.body.classList.remove('atp-ticker-active');
          document.body.style.paddingTop = '';
          return;
        }
        host = ensureTickerHost();
        host.innerHTML = renderTickerStrip(_tickerItems);
        host.classList.add('atp-ticker-on');
        // Theme: ticker now sits BELOW the nav (top: var(--nav-h)). The
        // body.atp-ticker-active class adds 44px padding so existing
        // page wraps (which already account for nav height) get pushed
        // down further, leaving room for the ticker without overlap.
        document.body.classList.add('atp-ticker-active');
        // Clear any inline style left over from previous "stick on top"
        // implementation — the new approach uses a CSS class instead.
        document.body.style.paddingTop = '';
      })
      .catch(function(){ /* silent fail — ticker is non-essential */ });
  }

  /* ── Mobile hamburger toggle ───────────────────────────────── */
  function handleHamburger(e) {
    var ham = e.target.closest('.hamburger');
    var nav = document.getElementById('nav');
    if (ham && nav) {
      var open = nav.classList.toggle('mobile-open');
      ham.setAttribute('aria-expanded', String(open));
      ham.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      return;
    }
    // Click on a nav link closes the drawer
    if (nav && nav.classList.contains('mobile-open') && e.target.closest('.nav-links a')) {
      nav.classList.remove('mobile-open');
      var h = nav.querySelector('.hamburger');
      if (h) { h.setAttribute('aria-expanded', 'false'); h.setAttribute('aria-label', 'Open menu'); }
      return;
    }
    // Click outside the nav closes the drawer
    if (nav && nav.classList.contains('mobile-open') && !e.target.closest('#nav')) {
      nav.classList.remove('mobile-open');
      var h2 = nav.querySelector('.hamburger');
      if (h2) { h2.setAttribute('aria-expanded', 'false'); h2.setAttribute('aria-label', 'Open menu'); }
    }
  }

  /* ── Boot ──────────────────────────────────────────────────── */
  // Ticker is intentionally limited to the member profile page (per
  // founder request). Other pages still get the boot/nav logic but
  // skip loadTicker() entirely so the marquee never mounts and the
  // body class never gets added — keeps the rest of the app clean.
  function _tickerAllowedHere() {
    var p = (window.location.pathname || '').toLowerCase();
    if (p === '/profile.html' || p === '/profile' || p === '/profile/') return true;
    // Page can opt-in explicitly by setting window.ATP_TICKER = true
    // before atp-components loads (future-proofing for new surfaces
    // like /coach or a logged-in dashboard).
    return !!window.ATP_TICKER;
  }

  function boot() {
    mountNav();
    if (_tickerAllowedHere()) loadTicker();
    document.addEventListener('click', handleNavClick);
    document.addEventListener('click', handleAuthAction);
    document.addEventListener('click', handleAtpCall);
    document.addEventListener('click', handleHamburger);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeAuthModal();
        var nav = document.getElementById('nav');
        if (nav && nav.classList.contains('mobile-open')) {
          nav.classList.remove('mobile-open');
          var h = nav.querySelector('.hamburger');
          if (h) { h.setAttribute('aria-expanded', 'false'); h.setAttribute('aria-label', 'Open menu'); }
        }
      }
    });
    window.addEventListener('atp:login',  rerenderAuth);
    window.addEventListener('atp:logout', rerenderAuth);
  }

  function handleAuthAction(e) {
    var btn = e.target.closest('[data-atp-action]');
    if (!btn) return;
    var act = btn.getAttribute('data-atp-action');
    if (act === 'auth-close') closeAuthModal();
    else if (act === 'auth-toggle') openAuthModal(_authMode === 'login' ? 'signup' : 'login');
  }

  /* ── Generic [data-atp-call] delegator ─────────────────────────
   * Migration path off inline onclick handlers. Markup:
   *   <button data-atp-call="loadSessions">Retry</button>
   * The delegator looks up window[funcName] and calls it with
   * (event, button). Args can be passed via data-arg-* attributes:
   *   <button data-atp-call="toggleCoach" data-arg-id="abc" data-arg-on="true">
   * The handler receives event + button + dataset, so it can read
   * btn.dataset.argId etc. Avoids inline onclick (CSP-safe) without
   * a per-page event-binding boilerplate.
   * ──────────────────────────────────────────────────────────── */
  function handleAtpCall(e) {
    var btn = e.target.closest('[data-atp-call]');
    if (!btn) return;
    var fnName = btn.getAttribute('data-atp-call');
    var fn = window[fnName];
    if (typeof fn !== 'function') {
      console.warn('[ATP] data-atp-call="' + fnName + '" — function not found on window');
      return;
    }
    // Parse args from data-args='["foo", 42]' if present
    var args = [];
    var rawArgs = btn.getAttribute('data-args');
    if (rawArgs) {
      try { args = JSON.parse(rawArgs); }
      catch (err) { console.warn('[ATP] bad data-args:', rawArgs, err); }
    }
    e.preventDefault();
    // Pass btn as the final arg so handlers that took (..., this) still work
    fn.apply(btn, args.concat(btn));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ── Expose ────────────────────────────────────────────────── */
  window.ATPComponents = {
    mountNav: mountNav,
    rerenderAuth: rerenderAuth,
    toast: toast,
    fieldError: fieldError,
    fieldClear: fieldClear,
    clearForm: clearForm,
    openAuthModal: openAuthModal,
    closeAuthModal: closeAuthModal,
    loadTicker: loadTicker,         // also re-runnable after admin saves an announcement
  };
})();
