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
    { key: 'home',      label: 'Home',      href: 'index.html' },
    { key: 'sessions',  label: 'Sessions',  href: 'sessions.html' },
    { key: 'community', label: 'Community', href: 'community.html' },
    { key: 'store',     label: 'Store',     href: 'store.html' },
    { key: 'partners',  label: 'Partners',  href: 'index.html#partners' },
    { key: 'about',     label: 'About',     href: 'index.html#story' },
  ];

  var LOGO_SRC = '/atp-logo-transparent.png';

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
          '<div class="hamburger"><span></span><span></span><span></span></div>' +
        '</div>' +
      '</nav>'
    );
  }

  function authMarkup() {
    var loggedIn = !!(window.ATP && window.ATP.isLoggedIn && window.ATP.isLoggedIn());
    if (!loggedIn) {
      return (
        '<button class="btn-ghost" data-atp-action="login">Log in</button>' +
        '<button class="btn-primary" data-atp-action="signup">Join free \u2192</button>'
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
      if (typeof window.openAuth === 'function') window.openAuth(action);
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

  /* ── Boot ──────────────────────────────────────────────────── */
  function boot() {
    mountNav();
    document.addEventListener('click', handleNavClick);
    window.addEventListener('atp:login',  rerenderAuth);
    window.addEventListener('atp:logout', rerenderAuth);
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
  };
})();
