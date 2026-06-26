/*!
 * ATP — Forgot password patch (2026-06-27)
 *
 * Wraps ATPComponents.openAuthModal so the login mode of the shared
 * auth modal gets a "Forgot your password?" link.  Clicking it
 * swaps the login form for an email-only "Send sign-in link" view
 * that POSTs /api/auth/magic-link.  The success copy points the
 * member at the email — once they click the magic link, the
 * auth-verify page offers them a "set a new password?" prompt
 * (see auth.js — JWT carries via:'magic_link').
 *
 * Self-contained, idempotent, and additive — does not modify the
 * existing modal markup. Pages already load this via atp.bundle.min.js
 * (the patch is appended at the bundle's end).
 */
(function () {
  if (window.__ATPForgotPatch) return;
  window.__ATPForgotPatch = true;

  function $(id) { return document.getElementById(id); }

  function injectForgotUI() {
    if ($('atp-forgot-link')) return; // already injected
    var form = $('atp-auth-form');
    if (!form || !form.parentNode) return;

    var link = document.createElement('div');
    link.id = 'atp-forgot-link';
    link.style.cssText = 'display:none;text-align:center;margin-top:14px;font-size:13px';
    link.innerHTML =
      '<button type="button" id="atp-forgot-btn" ' +
      'style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;text-decoration:underline;padding:0">' +
      'Forgot your password?</button>';

    var forgot = document.createElement('div');
    forgot.id = 'atp-forgot-view';
    forgot.style.cssText = 'display:none';
    forgot.innerHTML =
      '<p style="margin:0 0 18px;color:#aaa;font-size:14px;line-height:1.5">' +
        "Enter your email and we'll send you a one-tap sign-in link. After signing in you can set a new password." +
      '</p>' +
      '<div class="atp-field" style="margin-bottom:18px">' +
        '<input class="atp-input" id="atp-forgot-email" type="email" placeholder="you@email.com" autocomplete="email">' +
      '</div>' +
      '<button type="button" class="atp-btn atp-btn--primary atp-btn--lg" id="atp-forgot-submit" style="width:100%">' +
        'Send sign-in link</button>' +
      '<div id="atp-forgot-msg" style="display:none;margin-top:14px;padding:12px;border-radius:8px;font-size:14px"></div>' +
      '<div style="margin-top:14px;text-align:center">' +
        '<button type="button" id="atp-forgot-back" ' +
        'style="background:none;border:none;color:#aaa;cursor:pointer;font-size:13px">' +
        '← Back to login</button>' +
      '</div>';

    form.parentNode.insertBefore(link, form.nextSibling);
    form.parentNode.insertBefore(forgot, form.nextSibling);

    $('atp-forgot-btn').addEventListener('click', showForgot);
    $('atp-forgot-back').addEventListener('click', backToLogin);
    $('atp-forgot-submit').addEventListener('click', sendMagicLink);
    var emailEl = $('atp-forgot-email');
    if (emailEl) {
      emailEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendMagicLink(); }
      });
    }
  }

  function showForgot() {
    var form = $('atp-auth-form'); if (form) form.style.display = 'none';
    var link = $('atp-forgot-link'); if (link) link.style.display = 'none';
    var view = $('atp-forgot-view'); if (view) view.style.display = '';
    var title = $('atp-auth-title'); if (title) title.textContent = 'Reset access';
    var sub = $('atp-auth-sub');
    if (sub) sub.textContent = "We'll email you a one-tap sign-in link.";
    var toggle = document.querySelector('#atp-auth-modal [data-atp-action="auth-toggle"]');
    if (toggle && toggle.parentNode) toggle.parentNode.style.display = 'none';
    var msg = $('atp-forgot-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    var em = $('atp-forgot-email');
    if (em) { em.disabled = false; em.value = ''; setTimeout(function(){ em.focus(); }, 50); }
    var btn = $('atp-forgot-submit');
    if (btn) { btn.disabled = false; btn.textContent = 'Send sign-in link'; }
  }

  function backToLogin() {
    if (window.ATPComponents && window.ATPComponents.openAuthModal) {
      window.ATPComponents.openAuthModal('login');
    }
  }

  function _setMsg(kind, text) {
    var msg = $('atp-forgot-msg');
    if (!msg) return;
    var base = 'display:block;margin-top:14px;padding:12px;border-radius:8px;font-size:14px;line-height:1.5;';
    if (kind === 'success') {
      msg.style.cssText = base + 'background:rgba(168,255,0,.1);border:1px solid rgba(168,255,0,.3);color:#A8FF00';
    } else {
      msg.style.cssText = base + 'background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);color:#f87171';
    }
    msg.innerHTML = text;
  }

  function sendMagicLink() {
    var emailEl = $('atp-forgot-email');
    var btn = $('atp-forgot-submit');
    if (!emailEl || !btn) return;
    var email = (emailEl.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _setMsg('error', 'Enter a valid email.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email }),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = 'Send sign-in link';
          _setMsg('error', (res.body && res.body.error) || 'Could not send the link. Try again.');
          return;
        }
        _setMsg('success',
          '✓ Check your inbox. The sign-in link arrives in about 30 seconds. ' +
          'Click it to log in, then you can set a new password.');
        emailEl.disabled = true;
        btn.disabled = true;
        btn.textContent = 'Link sent';
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Send sign-in link';
        _setMsg('error', 'Connection error. Try again.');
      });
  }

  function patch() {
    if (!window.ATPComponents || !window.ATPComponents.openAuthModal) return false;
    var orig = window.ATPComponents.openAuthModal;
    if (orig.__forgotPatched) return true;
    window.ATPComponents.openAuthModal = function (mode) {
      var ret = orig.apply(this, arguments);
      injectForgotUI();
      var isLogin = mode === 'login';
      var link = $('atp-forgot-link');   if (link)   link.style.display   = isLogin ? '' : 'none';
      var view = $('atp-forgot-view');   if (view)   view.style.display   = 'none';
      var form = $('atp-auth-form');     if (form)   form.style.display   = '';
      var toggle = document.querySelector('#atp-auth-modal [data-atp-action="auth-toggle"]');
      if (toggle && toggle.parentNode) toggle.parentNode.style.display = '';
      return ret;
    };
    window.ATPComponents.openAuthModal.__forgotPatched = true;
    return true;
  }

  // Retry until ATPComponents lands, capped ~2 s.
  var tries = 0;
  var iv = setInterval(function () {
    if (patch() || ++tries > 40) clearInterval(iv);
  }, 50);
})();
