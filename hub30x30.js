/* DIC 30x30 Fitness Hub view on /sessions.html (founder 2026-10-16).
 *
 * When the "DIC 30x30 Hub" tab is on (currentVenue === 'dic'), the normal
 * list/calendar is hidden and this panel shows the hub in the 30x30 landing
 * page's design: weekly Sat–Fri grid (accordion on phones), activity chips,
 * week tabs, and the 30x30 booking card. Data and booking are the page's
 * own: sessions come from CAL_REAL_SESSIONS (same upcoming list) — the ones
 * created in admin with the "30x30 Hub" session category — and the chips are
 * the Activities picked on those sessions (Running, Yoga, Zumba…). Booking is
 * POST /api/bookings, sign-in goes through requireAuth() (in-page sign-up,
 * then the card reopens).
 */
(function () {
  'use strict';

  var HUB_START = Date.UTC(2026, 9, 30, 20);          // 31 Oct 00:00 Dubai
  var WEEKS = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]];
  var DESC = 'A free coached session at the 30x30 Fitness Hub, Dubai Internet City Amphitheatre — every level welcome.';
  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var st = { cat: 'all', week: null, mine: {} };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dubai(iso) { return new Date(Date.parse(iso) + 4 * 3600000); }            // UAE: UTC+4, no DST
  function hubDay(iso) { var d = dubai(iso); return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(2026, 9, 30)) / 86400000); }
  function dayDate(i) { return new Date(Date.UTC(2026, 9, 30 + i)); }
  function hhmm(iso) { var d = dubai(iso); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
  function t12(t) { var p = t.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + ' ' + (h < 12 ? 'AM' : 'PM'); }
  // Filter chip = the Activity chosen when the session was created in admin.
  function actOf(s) {
    var key = String(s.activity_slug || s.activity_id || '');
    return key ? { key: key, name: s.activity_name || 'Session', icon: s.activity_icon || '' } : { key: 'other', name: 'Other', icon: '' };
  }
  // Highlight style only (the gold "special" button), from the session name.
  function isSpecial(s) { return /opening night|festival|finale|special event|celebration/i.test(s.name || ''); }
  function token() { try { return localStorage.getItem('atp_token') || ''; } catch (e) { return ''; } }
  function api(path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/json' }, tk = token();
    if (tk) h.Authorization = 'Bearer ' + tk;
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch('/api' + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, data: j }; }); });
  }
  function shortLink(id) { var c = String(id).replace(/-/g, '').slice(0, 8); return location.origin + '/s/' + c; }
  function toast(msg) {
    var t = document.getElementById('h30Toast');
    if (!t) { t = document.createElement('div'); t.id = 'h30Toast'; t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#111;color:#fff;font:600 14px system-ui,sans-serif;padding:12px 18px;border-radius:4px;z-index:2100;opacity:0;transition:opacity .2s;max-width:calc(100vw - 32px);text-align:center'; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1'; clearTimeout(t._h); t._h = setTimeout(function () { t.style.opacity = '0'; }, 2600);
  }

  // ── data ───────────────────────────────────────────────
  function hubSessions() {
    var list = (typeof CAL_REAL_SESSIONS !== 'undefined' && CAL_REAL_SESSIONS) || [];
    return list.filter(function (s) { return typeof _venueOk === 'function' ? _venueOk(s.session_category) : false; })
      .map(function (s) { var a = actOf(s); return { s: s, day: hubDay(s.scheduled_at), t: hhmm(s.scheduled_at), cat: a.key, act: a, sp: isSpecial(s) }; })
      .filter(function (x) { return x.day >= 1 && x.day <= 30; })
      .sort(function (a, b) { return a.s.scheduled_at < b.s.scheduled_at ? -1 : 1; });
  }
  function byId(id) { var f = hubSessions().filter(function (x) { return String(x.s.id) === String(id); }); return f[0]; }
  function defaultWeek(items) {
    var today = hubDay(new Date().toISOString());
    if (today >= 1 && today <= 30) for (var w = 0; w < WEEKS.length; w++) if (today >= WEEKS[w][0] && today <= WEEKS[w][1]) return w;
    if (items.length) for (var k = 0; k < WEEKS.length; k++) if (items[0].day >= WEEKS[k][0] && items[0].day <= WEEKS[k][1]) return k;
    return 0;
  }

  // ── panel ──────────────────────────────────────────────
  function panel() {
    var p = document.getElementById('hub30');
    if (!p) {
      var main = document.querySelector('.sessions-main'); if (!main) return null;
      p = document.createElement('section'); p.id = 'hub30'; p.className = 'hub30'; main.insertBefore(p, main.firstChild);
      p.addEventListener('click', onClick);
    }
    return p;
  }
  function sesBtn(x, mobile) {
    var s = x.s, cap = +s.capacity || 0, bk = +s.registrations_count || 0, full = cap && bk >= cap;
    var cls = 'h30-ses' + (x.sp ? ' sp' : '') + (full ? ' full' : '') + (st.mine[s.id] ? ' mine' : '');
    var sub = full ? 'Full · join waitlist' : '';
    if (mobile) return '<button type="button" class="' + cls + '" data-h30="' + esc(s.id) + '"><strong>' + t12(x.t) + '</strong><span>' + esc(s.name) + (sub ? '<small>' + sub + '</small>' : '') + '</span></button>';
    return '<button type="button" class="' + cls + '" data-h30="' + esc(s.id) + '">' + esc(s.name) + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
  }
  function render() {
    var p = panel(); if (!p) return;
    var all = hubSessions();
    if (st.week === null) st.week = defaultWeek(all);
    // Chips: one per activity on the hub's sessions, A–Z, "Other" last.
    var acts = {}; all.forEach(function (x) { if (!acts[x.cat]) acts[x.cat] = x.act; });
    var chips = Object.keys(acts).sort(function (p, q) { return p === 'other' ? 1 : q === 'other' ? -1 : acts[p].name.localeCompare(acts[q].name); });
    if (st.cat !== 'all' && !acts[st.cat]) st.cat = 'all';
    var items = all.filter(function (x) { return st.cat === 'all' || x.cat === st.cat; });
    var w = WEEKS[st.week], days = [], i;
    for (i = w[0]; i <= w[1]; i++) days.push(i);
    var a = dayDate(w[0]), b = dayDate(w[1]);
    var loaded = typeof CAL_REAL_SESSIONS !== 'undefined' && CAL_REAL_SESSIONS && CAL_REAL_SESSIONS.length;

    var h = '<div class="h30-top"><div class="h30-eyebrow"><small>Dubai Fitness Challenge</small><h2>30x30 Fitness Hub Schedule</h2>' +
      '<p>31 Oct – 29 Nov · Dubai Internet City Amphitheatre · Free. Tap a session to book your spot.</p></div>' +
      '<div class="h30-logos"><img src="/img/30x30/logo-dic.png" alt="Dubai Internet City"><i></i><img src="/img/30x30/logo-30x30-hub.png" alt="30x30 Fitness Hub"></div></div>';
    // Activity menu (founder 2026-10-21): one burger button, the
    // activities in a dropdown — same as the landing page.
    var actLabel = function (k) { return k === 'all' ? 'All activities' : (acts[k].icon ? acts[k].icon + ' ' : '') + acts[k].name; };
    if (chips.length > 1) h += '<div class="h30-am">' +
      '<button type="button" class="h30-am-btn" aria-expanded="false" data-h30am>' +
        '<span class="h30-am-burger" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="h30-am-lbl"><small>Activity</small><b>' + esc(actLabel(st.cat)) + '</b></span><span class="h30-am-caret" aria-hidden="true"></span></button>' +
      '<div class="h30-am-panel" role="menu" hidden>' + ['all'].concat(chips).map(function (k) {
        return '<button type="button" role="menuitemradio" aria-checked="' + (st.cat === k) + '" class="h30-am-opt' + (st.cat === k ? ' on' : '') + '" data-h30cat="' + esc(k) + '">' + esc(actLabel(k)) + '</button>';
      }).join('') + '</div></div>';
    h += '<div class="h30-wtabs">' + WEEKS.map(function (r, k) { return '<button type="button" class="h30-wtab' + (k === st.week ? ' on' : '') + '" data-h30week="' + k + '">Week ' + (k + 1) + '</button>'; }).join('') + '</div>';
    h += '<div class="h30-whead"><b>WEEK ' + (st.week + 1) + '</b><span>' + a.getUTCDate() + ' ' + MONL[a.getUTCMonth()] + (w[0] === w[1] ? '' : ' – ' + b.getUTCDate() + ' ' + MONL[b.getUTCMonth()]) + '</span></div>';

    var inWeek = items.filter(function (x) { return x.day >= w[0] && x.day <= w[1]; });
    if (!inWeek.length) {
      h += '<div class="h30-empty">' + (!loaded ? '<b>Loading the schedule…</b>' :
        all.length ? '<b>No ' + (st.cat !== 'all' ? esc(acts[st.cat].name) + ' ' : '') + 'sessions this week</b>Try another week' + (st.cat !== 'all' ? ' or activity' : '') + '.' :
        '<b>30x30 sessions are coming soon</b>The hub runs 31 Oct – 29 Nov. Sessions open for booking here very soon.') + '</div>';
    } else {
      var times = {}; inWeek.forEach(function (x) { times[x.t] = 1; });
      var tl = Object.keys(times).sort();
      var g = '<table class="h30-grid"><thead><tr><th class="h30-time">Time</th>' + days.map(function (d) { var dd = dayDate(d); return '<th>' + DOW[dd.getUTCDay()] + '<b>' + dd.getUTCDate() + ' ' + MON[dd.getUTCMonth()] + '</b></th>'; }).join('') +
        (days.length < 7 ? '<th colspan="' + (7 - days.length) + '"></th>' : '') + '</tr></thead><tbody>';
      tl.forEach(function (t) {
        g += '<tr><td class="h30-time"><span class="h30-tchip">' + t + '</span></td>';
        days.forEach(function (d) { g += '<td>' + inWeek.filter(function (x) { return x.day === d && x.t === t; }).map(function (x) { return sesBtn(x); }).join('') + '</td>'; });
        if (days.length < 7) g += '<td colspan="' + (7 - days.length) + '" style="background:#fafafa"></td>';
        g += '</tr>';
      });
      h += '<div class="h30-desk">' + g + '</tbody></table></div>';
      h += '<div class="h30-mob">' + days.map(function (d, j) {
        var its = inWeek.filter(function (x) { return x.day === d; }), dd = dayDate(d);
        return '<details class="h30-day"' + (j === 0 || (j === 1 && !inWeek.some(function (x) { return x.day === days[0]; })) ? ' open' : '') + '><summary>' + DOWL[dd.getUTCDay()] + ' ' + dd.getUTCDate() + ' ' + MON[dd.getUTCMonth()] +
          '<span>' + its.length + ' session' + (its.length === 1 ? '' : 's') + '</span></summary><ul>' + its.map(function (x) { return '<li>' + sesBtn(x, true) + '</li>'; }).join('') + '</ul></details>';
      }).join('') + '</div>';
    }
    h += '<div class="h30-foot"><span>Book here or in the ATP app — same booking, same QR code.</span><a href="#" data-h30all>Show all ATP sessions</a></div>';
    p.innerHTML = h;
  }

  function amOpen(open) {
    var b = document.querySelector('[data-h30am]'), pn = document.querySelector('.h30-am-panel'); if (!b || !pn) return;
    b.setAttribute('aria-expanded', open ? 'true' : 'false'); pn.hidden = !open;
  }
  document.addEventListener('click', function (e) { if (!e.target.closest('.h30-am')) amOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') amOpen(false); });

  function onClick(e) {
    if (e.target.closest('[data-h30am]')) { var pn = document.querySelector('.h30-am-panel'); amOpen(pn && pn.hidden); return; }
    var c = e.target.closest('[data-h30cat]'); if (c) { st.cat = c.getAttribute('data-h30cat'); render(); return; }
    var w = e.target.closest('[data-h30week]'); if (w) { st.week = +w.getAttribute('data-h30week'); render(); return; }
    if (e.target.closest('[data-h30all]')) { e.preventDefault(); var all = document.querySelector('.filter-tab[data-atp-call="filterTribe"]'); if (all) all.click(); return; }
    var s = e.target.closest('[data-h30]'); if (s) open(s.getAttribute('data-h30'));
  }

  // ── booking card ───────────────────────────────────────
  function modal() {
    var m = document.getElementById('h30Mdl');
    if (!m) {
      m = document.createElement('div'); m.id = 'h30Mdl'; m.className = 'h30-mdl'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      m.innerHTML = '<div class="h30-mdl-bg" data-h30close></div><div class="h30-card"><div class="h30-ctop" id="h30Top"></div><div class="h30-cbody" id="h30Body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) {
        if (e.target.closest('[data-h30close]')) close();
        var wa = e.target.closest('[data-h30wa]'), cp = e.target.closest('[data-h30copy]');
        if (wa || cp) { var x = byId((wa || cp).getAttribute(wa ? 'data-h30wa' : 'data-h30copy')); if (x) invite(x, !!wa); }
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }
    return m;
  }
  function close() { var m = document.getElementById('h30Mdl'); if (m) m.classList.remove('on'); document.body.style.overflow = ''; }
  function inviteText(x) {
    var d = dayDate(x.day);
    return 'Join me at ' + x.s.name + ' 💚\n📅 ' + DOWL[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' · ' + t12(x.t) +
      '\n📍 DIC Amphitheatre · 30x30 Fitness Hub\nIt’s free 🙌\n\nBook your spot: ' + shortLink(x.s.id);
  }
  function invite(x, whatsapp) {
    var txt = inviteText(x);
    if (whatsapp) { window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener'); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Invite copied — paste it anywhere'); }, function () { toast('Copy failed — long-press to copy'); });
  }
  function open(id) {
    var x = byId(id); if (!x) return;
    var s = x.s, d = dayDate(x.day), free = !(+s.price > 0 || +s.price_points > 0);
    var cap = +s.capacity || 0, bk = +s.registrations_count || 0;
    var m = modal();
    document.getElementById('h30Top').innerHTML = '<small>' + esc(x.act.key === 'other' ? '30x30 Fitness Hub' : x.act.name + ' · 30x30 Fitness Hub') + '</small><h3 id="h30Title">' + esc(s.name) + '</h3><button type="button" class="h30-x" data-h30close aria-label="Close">✕</button>';
    m.setAttribute('aria-labelledby', 'h30Title');
    var venue = s.location_maps_url ? '<a href="' + esc(s.location_maps_url) + '" target="_blank" rel="noopener">' + esc(s.location) + ' ↗</a>' : esc(s.location || 'DIC Amphitheatre');
    document.getElementById('h30Body').innerHTML =
      '<div class="h30-info"><div><h5>Date</h5><p>' + DOWL[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONL[d.getUTCMonth()] + '</p></div>' +
      '<div><h5>Time</h5><p>' + t12(x.t) + (s.duration_mins ? ' · ' + s.duration_mins + ' min' : '') + '</p></div>' +
      '<div><h5>Venue</h5><p>' + venue + '</p></div><div><h5>Price</h5><p>' + (free ? 'Free' : (+s.price > 0 ? esc((s.currency_code || 'AED').toUpperCase()) + ' ' + Number(s.price).toFixed(0) : +s.price_points + ' pts')) + '</p></div></div>' +
      '<p class="h30-desc">' + esc(s.description || DESC) + '</p>' +
      (cap ? '<div class="h30-cap"><div class="h30-bar"><i style="width:' + Math.min(100, Math.round(bk / cap * 100)) + '%"></i></div><p><span>' + bk + ' / ' + cap + ' booked' + (+s.waitlist_count ? ' · ' + s.waitlist_count + ' on waitlist' : '') + '</span><span>' + (bk >= cap ? 'Full — join the waitlist' : (cap - bk) + ' spots left') + '</span></p></div>' : '') +
      '<div class="h30-inv"><button type="button" class="wa" data-h30wa="' + esc(s.id) + '">Invite on WhatsApp</button><button type="button" data-h30copy="' + esc(s.id) + '">Copy invite link</button></div>' +
      '<div id="h30Act"></div>';
    m.classList.add('on'); document.body.style.overflow = 'hidden';
    var card = m.querySelector('.h30-card'); if (card) card.scrollTop = 0;
    action(x);
  }
  function action(x) {
    var s = x.s, act = document.getElementById('h30Act'), cap = +s.capacity || 0, bk = +s.registrations_count || 0;
    var free = !(+s.price > 0 || +s.price_points > 0);
    if (!free) {   // paid sessions finish on the regular flow (payment options)
      act.innerHTML = '<a class="h30-btn" href="/sessions.html?session=' + encodeURIComponent(s.id) + '">Book this session</a>';
      return;
    }
    if (!token()) {
      act.innerHTML = '<button type="button" class="h30-btn" id="h30Go">' + (cap && bk >= cap ? 'Join the waitlist' : 'Book my free spot') + '</button><p class="h30-note">New to ATP? Join free in a few seconds — then your spot is booked.</p>';
      document.getElementById('h30Go').addEventListener('click', function () {
        close();
        if (typeof requireAuth === 'function') requireAuth(function () { open(s.id); });
      });
      return;
    }
    act.innerHTML = '<p class="h30-note">Checking your booking…</p>';
    api('/sessions/' + encodeURIComponent(s.id)).then(function (r) {
      var mb = r.data && r.data.myBooking;
      if (mb && mb.status !== 'cancelled') {
        st.mine[s.id] = true;
        act.innerHTML = '<div class="h30-done"><div class="h30-ok">✓</div><h4>You’re booked</h4><p>Show this QR code at the amphitheatre. It’s also in the ATP app under My bookings.</p>' +
          (mb.qr_token ? '<img class="h30-qr" alt="Check-in QR code" src="/api/bookings/qr/' + encodeURIComponent(mb.qr_token) + '.png">' : '') +
          '<div class="h30-acts"><a class="h30-btn line" href="' + shortLink(s.id) + '">Open in ATP</a><button type="button" class="h30-btn line" data-h30wa="' + esc(s.id) + '">Invite friends</button></div>' +
          '<button type="button" class="h30-cx" id="h30Cancel">Cancel booking</button></div>';
        render();
        document.getElementById('h30Cancel').addEventListener('click', function () {
          api('/bookings/' + encodeURIComponent(mb.id), { method: 'DELETE' }).then(function (c) {
            if (c.status >= 400) { toast((c.data && c.data.error) || 'Could not cancel — try again'); return; }
            delete st.mine[s.id]; s.registrations_count = Math.max(0, bk - 1); open(s.id); render(); toast('Booking cancelled');
          });
        });
        return;
      }
      if (r.data && typeof r.data.myWaitlistPos === 'number') {
        act.innerHTML = '<div class="h30-done"><h4>You’re on the waitlist</h4><p>Position #' + r.data.myWaitlistPos + '. We’ll let you know in the ATP app if a spot opens.</p></div>';
        return;
      }
      act.innerHTML = '<label class="h30-tc"><input type="checkbox" id="h30Tc"> <span>I agree to the <a href="/terms" target="_blank" rel="noopener">terms &amp; conditions</a> for this session.</span></label>' +
        '<button type="button" class="h30-btn" id="h30Go" disabled>' + (cap && bk >= cap ? 'Join the waitlist' : 'Book my free spot') + '</button><p class="h30-note">Your booking appears in the ATP app straight away — same QR code.</p>';
      var tc = document.getElementById('h30Tc'), go = document.getElementById('h30Go');
      tc.addEventListener('change', function () { go.disabled = !tc.checked; });
      go.addEventListener('click', function () {
        go.disabled = true;
        api('/bookings', { method: 'POST', body: { session_id: s.id } }).then(function (b) {
          if (b.status === 201 || b.status === 409) { if (b.status === 201) s.registrations_count = bk + 1; open(s.id); toast('Booked — it’s in your ATP app too'); return; }
          if (b.status === 202 && b.data && b.data.status === 'waitlisted') { open(s.id); toast('You’re on the waitlist'); return; }
          if (b.status === 401) { close(); if (typeof requireAuth === 'function') requireAuth(function () { open(s.id); }); return; }
          go.disabled = false; toast((b.data && b.data.error) || 'Booking failed — try again');
        });
      });
    });
  }

  // ── hook from applyFilters() on the sessions page ─────────
  // 30x30 Challenges tab (founder 2026-10-19): same white hub look; the
  // content (cards, challenge calendar, registration, leaderboards) is the
  // shared hub-challenges.js, mounted once.
  function syncChallenges(on, main) {
    var cp = document.getElementById('hubch');
    if (!on) { if (cp) cp.style.display = 'none'; return; }
    if (!cp) {
      cp = document.createElement('section'); cp.id = 'hubch'; cp.className = 'hub30';
      cp.innerHTML = '<div class="h30-top"><div class="h30-eyebrow"><small>Dubai Fitness Challenge</small><h2>30x30 Challenge Series</h2>' +
        '<p>Individual and team challenges at the Dubai Internet City Amphitheatre · Free. Book a qualifier slot — every attempt counts, your best result ranks.</p></div>' +
        '<div class="h30-logos"><img src="/img/30x30/logo-dic.png" alt="Dubai Internet City"><i></i><img src="/img/30x30/logo-30x30-hub.png" alt="30x30 Fitness Hub"></div></div>' +
        '<div id="hubchCards"></div><h3 class="hubch-h">Challenge calendar</h3><div id="hubchCal"></div>' +
        '<h3 class="hubch-h">Leaderboards</h3><div id="hubchBoards"></div>' +
        '<div class="h30-foot"><span>Register here or in the ATP app — same booking, same QR code.</span><a href="#" data-h30all>Show all ATP sessions</a></div>';
      main.insertBefore(cp, main.firstChild);
      cp.addEventListener('click', function (e) { if (e.target.closest('[data-h30all]')) { e.preventDefault(); var all = document.querySelector('.filter-tab[data-atp-call="filterTribe"]'); if (all) all.click(); } });
      if (window.HubCh) window.HubCh.mount({ cards: document.getElementById('hubchCards'), calendar: document.getElementById('hubchCal'), boards: document.getElementById('hubchBoards') });
    }
    cp.style.display = '';
  }
  function sync() {
    var main = document.querySelector('.sessions-main'); if (!main) return;
    var venue = typeof currentVenue !== 'undefined' ? currentVenue : '';
    var on = venue === 'dic', chal = venue === 'chal';
    main.classList.toggle('hub-mode', on || chal);
    var p = document.getElementById('hub30');
    if (on) render();
    else if (p) { p.innerHTML = ''; p.style.display = 'none'; }
    if (on && (p = document.getElementById('hub30'))) p.style.display = '';
    syncChallenges(chal, main);
  }
  window.Hub30 = { sync: sync, open: open };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
