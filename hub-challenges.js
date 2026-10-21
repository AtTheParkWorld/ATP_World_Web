/* 30x30 Challenges — shared front end (founder 2026-10-19).
 *
 * Used by the 30x30 landing page (/30x30-hub) and the "30x30 Challenges" tab
 * on /sessions.html. Everything comes from the ATP calendar + API, so a
 * registration here is the same one members see in the app:
 *   - slots = sessions with session_category '30x30_challenge'
 *   - individual challenge: book a qualifier slot (that IS the registration)
 *   - team challenge: the captain creates the team (name) and shares the
 *     invite link; teammates open it, join, and book the team's slot
 *   - charity cause: after registering, members are asked (optional) if
 *     they'd like to donate — "Donate" opens the charity's own page
 *   - finals can't be booked; leaderboards show the finals cut
 * The server enforces the rules (one slot per day, teams, finals).
 *
 *   HubCh.mount({ cards, calendar, boards })  — any of the three containers
 * Deep links: ?team=CODE (join a team) · ?slot=<session id> · ?challenge=<id>
 */
(function () {
  'use strict';
  if (window.HubCh) return;

  var HUB0 = Date.UTC(2026, 9, 30);   // day 1 = Sat 31 Oct 2026
  var WEEKS = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]];
  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var SPONSORS = [
    { re: /reebok|burpee/i, name: 'Reebok', logo: '/img/30x30/sponsor-reebok.png' }
  ];

  var S = { challenges: [], byId: {}, slots: [], loaded: false, cat: 'all', week: null, boardCh: null, boardStage: 'qualifier', el: {} };

  // ── utils ─────────────────────────────────────────────────────
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() { try { return localStorage.getItem('atp_token') || ''; } catch (e) { return ''; } }
  function api(path, opts) {
    opts = opts || {};
    var h = { Accept: 'application/json' }, tk = token();
    if (tk) h.Authorization = 'Bearer ' + tk;
    if (opts.body) h['Content-Type'] = 'application/json';
    return fetch('/api' + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.text().then(function (t) { var d = {}; try { d = JSON.parse(t); } catch (e) {} return { status: r.status, data: d }; }); },
            function () { return { status: 0, data: { error: 'Connection error — please check your internet.' } }; });
  }
  function dubai(iso) { return new Date(Date.parse(iso) + 4 * 3600000); }
  function hubDay(iso) { var d = dubai(iso); return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - HUB0) / 86400000); }
  function dayDate(i) { return new Date(HUB0 + i * 86400000); }
  function hhmm(iso) { var d = dubai(iso); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
  function t12(t) { var p = t.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function whenLong(iso) { var d = dubai(iso); return DOWL[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONL[d.getUTCMonth()] + ' · ' + t12(hhmm(iso)); }
  function dayLabel(ymd) { if (!ymd) return ''; var d = new Date(String(ymd).slice(0, 10) + 'T12:00:00Z'); return DOW[d.getUTCDay()].charAt(0) + DOW[d.getUTCDay()].slice(1).toLowerCase() + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }
  function fmt(v, c) {
    if (v == null) return '—';
    if (c.result_type === 'score') return (+v) + (c.result_unit ? ' ' + c.result_unit : '');
    var s = +v, m = Math.floor(s / 60), r = Math.round((s - m * 60) * 10) / 10;
    var rs = r % 1 ? r.toFixed(1) : String(r);
    return m ? m + ':' + (r < 10 ? '0' : '') + rs : rs + 's';
  }
  function sponsorOf(name) { for (var i = 0; i < SPONSORS.length; i++) if (SPONSORS[i].re.test(name || '')) return SPONSORS[i]; return null; }
  var NO_LOGO = {};
  function logo(name, cls) {
    var sp = sponsorOf(name);
    return sp && !NO_LOGO[sp.logo] ? '<img class="' + cls + '" data-hc-logo src="' + sp.logo + '" alt="' + esc(sp.name) + '">' : '';
  }
  document.addEventListener('error', function (e) { var t = e.target; if (t && t.hasAttribute && t.hasAttribute('data-hc-logo')) { NO_LOGO[t.getAttribute('src')] = 1; t.remove(); } }, true);
  function kindLabel(c) { return c.kind === 'team' ? 'Team · ' + (c.team_min === c.team_max ? c.team_max : c.team_min + '–' + c.team_max) + ' members' : 'Individual'; }
  function toast(m) {
    var t = document.getElementById('hcToast');
    if (!t) { t = document.createElement('div'); t.id = 'hcToast'; t.className = 'hc-toast'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('on'); }, 2800);
  }
  function signIn(after, next) {
    if (typeof window.requireAuth === 'function') { window.requireAuth(after); return; }
    location.href = '/join?mode=login&next=' + encodeURIComponent(next || (location.pathname + location.search));
  }

  // ── styles ────────────────────────────────────────────────────
  function css() {
    if (document.getElementById('hc-css')) return;
    var st = document.createElement('style'); st.id = 'hc-css';
    st.textContent = [
      '.hc-wrap{font-family:inherit;color:#414042}',
      '.hc-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}',
      '.hc-chip{border:1px solid #e1e1e1;background:#fff;border-radius:999px;padding:7px 14px;font:inherit;font-size:14px;cursor:pointer;color:#222}',
      '.hc-chip.on{background:#c9ba9e;border-color:#c9ba9e;color:#111;font-weight:700}',
      '.hc-wtabs{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #e6e6e6;margin-bottom:12px}',
      '.hc-wtab{padding:12px 6px;background:#fff;border:0;border-left:1px solid #e6e6e6;font:inherit;font-size:13px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;color:#6f6f6f}',
      '.hc-wtab:first-child{border-left:0}.hc-wtab.on{background:#c9ba9e;color:#111;font-weight:700}',
      '.hc-grid{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}',
      '.hc-grid th{background:#1d1d1d;color:#c9ba9e;padding:10px 4px;font-size:11px;letter-spacing:.14em;font-weight:600}.hc-grid th b{display:block;color:#fff;font-size:15px;letter-spacing:0;margin-top:2px}',
      '.hc-grid td{border:1px solid #ececec;vertical-align:top;padding:5px;height:58px}',
      '.hc-grid td.hc-time{width:86px;text-align:center;vertical-align:middle;background:#fafafa}',
      '.hc-tchip{display:inline-block;background:#eee7da;border-radius:999px;padding:5px 10px;font-weight:700;font-size:12px;color:#222}',
      '.hc-ses{display:block;width:100%;text-align:left;background:#fff5f5;border:0;border-left:3px solid #f90000;padding:7px 8px;margin:3px 0;font:inherit;font-size:13px;font-weight:600;color:#222;cursor:pointer;line-height:1.25}',
      '.hc-ses:hover{background:#ffeaea}.hc-ses small{display:block;font-size:11px;font-weight:500;color:#6f6f6f;margin-top:2px}',
      '.hc-ses.final{background:#fbf5e6;border-left-color:#b8892b}.hc-ses.mine::after{content:" ✓";color:#1a8f4a}',
      '.hc-mob{display:none}.hc-day{border:1px solid #ececec;margin-bottom:8px;background:#fff}.hc-day summary{padding:12px 14px;font-weight:700;cursor:pointer;display:flex;justify-content:space-between}.hc-day summary span{color:#6f6f6f;font-weight:500;font-size:13px}.hc-day ul{list-style:none;margin:0;padding:0 10px 10px}',
      '.hc-empty{padding:34px 16px;text-align:center;color:#6f6f6f;border:1px dashed #ddd;background:#fff}.hc-empty b{display:block;color:#222;font-size:17px;margin-bottom:4px}',
      '.hc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}',
      '.hc-card{border:1px solid #e6e6e6;border-top:3px solid #f90000;background:#fff;padding:20px 18px;display:flex;flex-direction:column;position:relative}',
      '.hc-card.team{border-top-color:#1a8f4a}.hc-card h3{font-size:22px;margin:6px 0 2px;color:#222}.hc-card .hc-kind{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#f90000}',
      '.hc-card.team .hc-kind{color:#1a8f4a}.hc-card p{font-size:14px;margin:10px 0 0;line-height:1.5}',
      '.hc-card dl{margin:12px 0 14px;font-size:13px;flex:1}.hc-card dt{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6f6f6f;margin-top:8px}.hc-card dd{margin:0;color:#222}',
      '.hc-logo{height:32px;max-width:120px;object-fit:contain;display:block;margin-bottom:8px}',
      '.hc-btn{display:block;width:100%;border:0;border-radius:5px;padding:12px 16px;font:inherit;font-size:15px;font-weight:700;cursor:pointer;background:#f90000;color:#fff;text-align:center;text-decoration:none}',
      '.hc-btn:hover{background:#d40000}.hc-btn.line{background:#fff;color:#222;border:1px solid #222}.hc-btn.green{background:#1a8f4a}.hc-btn[disabled]{opacity:.5;cursor:default}',
      '.hc-mine{font-size:12px;color:#1a8f4a;font-weight:700;margin-bottom:8px}',
      '.hc-cause{display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:#1a8f4a}',
      '.hc-mdl{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:16px}.hc-mdl.on{display:flex}',
      '.hc-mdl-bg{position:absolute;inset:0;background:rgba(0,0,0,.55)}',
      '.hc-mdl-card{position:relative;background:#fff;width:100%;max-width:480px;max-height:calc(100vh - 32px);overflow:auto;border-radius:6px;color:#414042}',
      '.hc-mdl-top{background:#c9ba9e;padding:18px 56px 16px 22px;position:relative}.hc-mdl-top small{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#000;opacity:.7}.hc-mdl-top h3{font-size:24px;margin:4px 0 0;color:#111}',
      '.hc-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border-radius:50%;border:0;background:#fff;font-size:16px;cursor:pointer}',
      '.hc-mdl-body{padding:18px 22px 22px}.hc-mdl-body p{font-size:14px;line-height:1.55;margin:0 0 12px}',
      '.hc-info{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}.hc-info h5{margin:0;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#6f6f6f}.hc-info div p{margin:2px 0 0;color:#222;font-weight:600}',
      '.hc-note{font-size:12px;color:#6f6f6f;margin-top:8px;text-align:center}.hc-err{color:#c00;font-size:13px;margin:8px 0}',
      '.hc-in{width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:5px;padding:11px 12px;font:inherit;font-size:15px;margin:6px 0 10px}',
      '.hc-box{border:1px solid #e6e6e6;border-radius:6px;padding:14px;margin:12px 0;background:#fafafa}.hc-box h4{margin:0 0 6px;font-size:15px;color:#222}',
      '.hc-share{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.hc-share .hc-btn{font-size:13px;padding:10px}',
      '.hc-link{word-break:break-all;font-size:12px;background:#fff;border:1px dashed #ccc;padding:8px;border-radius:4px;color:#222}',
      '.hc-qr{display:block;width:170px;height:170px;margin:10px auto;border:1px solid #eee;padding:6px;background:#fff}',
      '.hc-ok{width:48px;height:48px;border-radius:50%;background:#e9f7ef;color:#1a8f4a;font-size:24px;font-weight:700;display:grid;place-items:center;margin:0 auto 8px}',
      '.hc-tc{display:flex;gap:8px;font-size:13px;margin:10px 0;align-items:flex-start}',
      '.hc-slots button{display:flex;justify-content:space-between;width:100%;border:1px solid #eee;border-left:3px solid #f90000;background:#fff;padding:10px 12px;margin:6px 0;font:inherit;font-size:14px;cursor:pointer;text-align:left}',
      '.hc-slots button span{color:#6f6f6f;font-size:12px}',
      '.hc-btabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.hc-seg{display:inline-flex;border:1px solid #ddd;border-radius:999px;overflow:hidden;margin-bottom:12px}.hc-seg button{border:0;background:#fff;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer}.hc-seg button.on{background:#222;color:#fff}',
      '.hc-boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}',
      '.hc-board{border:1px solid #e6e6e6;background:#fff}.hc-board h4{margin:0;padding:10px 14px;background:#1d1d1d;color:#c9ba9e;font-size:12px;letter-spacing:.12em;text-transform:uppercase}',
      '.hc-row{display:flex;gap:10px;padding:9px 14px;border-top:1px solid #f0f0f0;font-size:14px}.hc-row .rk{width:26px;color:#6f6f6f;font-weight:700}.hc-row .nm{flex:1;color:#222}.hc-row .v{font-weight:700;color:#222}',
      '.hc-row.q{background:#f3fbf5}.hc-row.out{opacity:.6}.hc-cutline{padding:6px 14px;background:#fff0f0;color:#c00;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;text-align:center}',
      '.hc-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#111;color:#fff;padding:12px 18px;border-radius:4px;font-size:14px;font-weight:600;z-index:2100;opacity:0;transition:opacity .2s;max-width:calc(100vw - 32px);text-align:center;pointer-events:none}.hc-toast.on{opacity:1}',
      '@media(max-width:900px){.hc-desk{display:none}.hc-mob{display:block}.hc-wtab{font-size:11px;letter-spacing:.06em}.hc-ses{display:flex;gap:10px;align-items:center}.hc-ses strong{flex:0 0 48px}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── data ──────────────────────────────────────────────────────
  function load() {
    return Promise.all([api('/hub-challenges'), api('/sessions?status=upcoming&limit=1000')]).then(function (r) {
      S.challenges = (r[0].data && r[0].data.challenges) || [];
      S.byId = {}; S.challenges.forEach(function (c) { S.byId[c.id] = c; });
      S.slots = ((r[1].data && r[1].data.sessions) || [])
        .filter(function (s) { return s.session_category === '30x30_challenge' && S.byId[s.hub_challenge_id]; })
        .map(function (s) { return { s: s, c: S.byId[s.hub_challenge_id], day: hubDay(s.scheduled_at), t: hhmm(s.scheduled_at), final: s.hub_challenge_stage === 'final' }; })
        .sort(function (a, b) { return a.s.scheduled_at < b.s.scheduled_at ? -1 : 1; });
      if (!S.boardCh && S.challenges.length) S.boardCh = S.challenges[0].id;
      S.loaded = true;
    });
  }
  function slotById(id) { return S.slots.filter(function (x) { return String(x.s.id) === String(id); })[0]; }

  // ── cards ─────────────────────────────────────────────────────
  function renderCards() {
    var el = S.el.cards; if (!el) return;
    if (!S.loaded) { el.innerHTML = '<div class="hc-empty">Loading the challenges…</div>'; return; }
    if (!S.challenges.length) { el.innerHTML = '<div class="hc-empty"><b>The 30x30 Challenge Series is coming soon</b>Registration opens here and in the ATP app.</div>'; return; }
    el.innerHTML = '<div class="hc-cards">' + S.challenges.map(function (c) {
      var mine = c.my_entry, open = S.slots.filter(function (x) { return x.c.id === c.id && !x.final; }).length;
      var mineTxt = mine ? (c.kind === 'team' && mine.team ? '✓ Your team: ' + esc(mine.team.name) + ' (' + mine.team.members + '/' + c.team_max + ')' : '✓ You’re registered') : '';
      return '<div class="hc-card' + (c.kind === 'team' ? ' team' : '') + '">' + logo(c.name, 'hc-logo') +
        '<span class="hc-kind">' + esc(kindLabel(c)) + '</span><h3>' + esc(c.name) + '</h3>' +
        (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
        '<dl>' + (c.qualifier_start ? '<dt>Qualifiers</dt><dd>' + dayLabel(c.qualifier_start) + ' – ' + dayLabel(c.qualifier_end) + '</dd>' : '') +
        (c.final_date ? '<dt>Final</dt><dd>' + dayLabel(c.final_date) + '</dd>' : '') +
        (c.finals_cut_enabled ? '<dt>Make the cut</dt><dd>Top ' + c.finals_cut + (c.kind === 'team' ? (c.finals_cut === 1 ? ' team' : ' teams') : c.split_gender ? ' men + top ' + c.finals_cut + ' women' : '') + '</dd>' : '') + '</dl>' +
        (c.charity_enabled ? '<span class="hc-cause">💚 For ' + esc(c.charity_name) + '</span>' : '') +
        (mineTxt ? '<div class="hc-mine" style="margin-top:10px">' + mineTxt + '</div>' : '') +
        '<button type="button" class="hc-btn' + (mine ? ' line' : '') + '" style="margin-top:12px" data-hc-ch="' + esc(c.id) + '">' +
          (mine ? (c.kind === 'team' ? 'My team & slots' : 'My slots') : open ? (c.kind === 'team' ? 'Register a team' : 'Book a slot') : 'See details') + '</button></div>';
    }).join('') + '</div>';
  }

  // ── calendar ──────────────────────────────────────────────────
  function weekOf(day) { for (var w = 0; w < WEEKS.length; w++) if (day >= WEEKS[w][0] && day <= WEEKS[w][1]) return w; return 0; }
  function renderCalendar() {
    var el = S.el.calendar; if (!el) return;
    if (!S.loaded) { el.innerHTML = '<div class="hc-empty">Loading the challenge calendar…</div>'; return; }
    var items = S.slots.filter(function (x) { return x.day >= 1 && x.day <= 30 && (S.cat === 'all' || x.c.id === S.cat); });
    if (S.week === null) {
      var today = hubDay(new Date().toISOString()), first = items[0];
      S.week = today >= 1 && today <= 30 ? weekOf(today) : first ? weekOf(first.day) : 0;
    }
    var chips = S.challenges.length > 1 ? '<div class="hc-chips">' + [['all', 'All challenges']].concat(S.challenges.map(function (c) { return [c.id, c.name]; })).map(function (k) {
      return '<button type="button" class="hc-chip' + (S.cat === k[0] ? ' on' : '') + '" data-hc-cat="' + esc(k[0]) + '">' + esc(k[1]) + '</button>';
    }).join('') + '</div>' : '';
    var tabs = '<div class="hc-wtabs">' + WEEKS.map(function (w, i) { return '<button type="button" class="hc-wtab' + (i === S.week ? ' on' : '') + '" data-hc-week="' + i + '">Week ' + (i + 1) + '</button>'; }).join('') + '</div>';
    var w = WEEKS[S.week], days = []; for (var d = w[0]; d <= w[1]; d++) days.push(d);
    var inWeek = items.filter(function (x) { return x.day >= w[0] && x.day <= w[1]; });
    var body;
    if (!S.slots.length) body = '<div class="hc-empty"><b>Challenge slots are coming soon</b>Qualifier slots open for registration here and in the ATP app.</div>';
    else if (!inWeek.length) body = '<div class="hc-empty"><b>No challenge slots this week</b>Try another week' + (S.cat !== 'all' ? ' or challenge' : '') + '.</div>';
    else {
      var times = {}; inWeek.forEach(function (x) { times[x.t] = 1; });
      var g = '<table class="hc-grid"><thead><tr><th class="hc-time" style="background:#1d1d1d">Time</th>' + days.map(function (dd) { var dt = dayDate(dd); return '<th>' + DOW[dt.getUTCDay()] + '<b>' + dt.getUTCDate() + ' ' + MON[dt.getUTCMonth()] + '</b></th>'; }).join('') +
        (days.length < 7 ? '<th colspan="' + (7 - days.length) + '"></th>' : '') + '</tr></thead><tbody>';
      Object.keys(times).sort().forEach(function (t) {
        g += '<tr><td class="hc-time"><span class="hc-tchip">' + t + '</span></td>';
        days.forEach(function (dd) { g += '<td>' + inWeek.filter(function (x) { return x.day === dd && x.t === t; }).map(function (x) { return slotBtn(x); }).join('') + '</td>'; });
        if (days.length < 7) g += '<td colspan="' + (7 - days.length) + '" style="background:#fafafa"></td>';
        g += '</tr>';
      });
      body = '<div class="hc-desk">' + g + '</tbody></table></div><div class="hc-mob">' + days.map(function (dd, j) {
        var its = inWeek.filter(function (x) { return x.day === dd; }), dt = dayDate(dd);
        if (!its.length) return '';
        return '<details class="hc-day" open><summary>' + DOWL[dt.getUTCDay()] + ' ' + dt.getUTCDate() + ' ' + MON[dt.getUTCMonth()] + '<span>' + its.length + ' slot' + (its.length === 1 ? '' : 's') + '</span></summary><ul>' +
          its.map(function (x) { return '<li>' + slotBtn(x, true) + '</li>'; }).join('') + '</ul></details>';
      }).join('') + '</div>';
    }
    el.innerHTML = chips + tabs + body;
  }
  function slotBtn(x, mobile) {
    var cls = 'hc-ses' + (x.final ? ' final' : '');
    var sub = x.final ? 'Final · qualified athletes' : (x.c.kind === 'team' ? 'Team qualifier' : 'Qualifier');
    if (mobile) return '<button type="button" class="' + cls + '" data-hc-slot="' + esc(x.s.id) + '"><strong>' + x.t + '</strong><span>' + esc(x.c.name) + '<small>' + sub + '</small></span></button>';
    return '<button type="button" class="' + cls + '" data-hc-slot="' + esc(x.s.id) + '">' + esc(x.c.name) + '<small>' + sub + '</small></button>';
  }

  // ── leaderboards ──────────────────────────────────────────────
  function renderBoards() {
    var el = S.el.boards; if (!el) return;
    if (!S.loaded) { el.innerHTML = '<div class="hc-empty">Loading results…</div>'; return; }
    if (!S.challenges.length) { el.innerHTML = '<div class="hc-empty"><b>Results appear here</b>Published by the ATP team after each session.</div>'; return; }
    var c = S.byId[S.boardCh] || S.challenges[0];
    el.innerHTML = '<div class="hc-btabs">' + S.challenges.map(function (x) { return '<button type="button" class="hc-chip' + (x.id === c.id ? ' on' : '') + '" data-hc-board="' + esc(x.id) + '">' + esc(x.name) + '</button>'; }).join('') + '</div>' +
      '<div class="hc-seg"><button type="button" class="' + (S.boardStage === 'qualifier' ? 'on' : '') + '" data-hc-stage="qualifier">Qualifiers</button><button type="button" class="' + (S.boardStage === 'final' ? 'on' : '') + '" data-hc-stage="final">Final</button></div>' +
      '<div id="hcBoardsBody"><div class="hc-empty">Loading…</div></div>';
    api('/hub-challenges/' + encodeURIComponent(c.id) + '/leaderboard?stage=' + S.boardStage).then(function (r) {
      var host = document.getElementById('hcBoardsBody'); if (!host) return;
      var d = r.data || {};
      if (!d.boards || !d.boards.some(function (b) { return b.rows.length; })) {
        host.innerHTML = '<div class="hc-empty"><b>No ' + (S.boardStage === 'final' ? 'final' : 'qualifier') + ' results yet</b>Results are checked and published by the ATP team after each session.</div>'; return;
      }
      host.innerHTML = '<div class="hc-boards">' + d.boards.map(function (b) {
        var rows = '', cutDrawn = false;
        b.rows.forEach(function (row) {
          if (d.finals_cut && S.boardStage === 'qualifier' && !cutDrawn && row.qualified === false) { rows += '<div class="hc-cutline">Finals cut · top ' + d.finals_cut + '</div>'; cutDrawn = true; }
          rows += '<div class="hc-row' + (S.boardStage === 'qualifier' && row.qualified === true ? ' q' : '') + (S.boardStage === 'qualifier' && row.qualified === false ? ' out' : '') + '"><span class="rk">' + row.rank + '</span><span class="nm">' + esc(row.name) + '</span><span class="v">' + esc(fmt(row.value, c)) + '</span></div>';
        });
        return '<div class="hc-board"><h4>' + esc(b.label) + '</h4>' + rows + '</div>';
      }).join('') + '</div>' + (d.finals_cut && S.boardStage === 'qualifier' ? '<p class="hc-note" style="text-align:left">Green = qualifying for the final. Every attempt counts — your best result ranks.</p>' : '');
    });
  }

  // ── modal ─────────────────────────────────────────────────────
  function modal() {
    var m = document.getElementById('hcMdl');
    if (!m) {
      m = document.createElement('div'); m.id = 'hcMdl'; m.className = 'hc-mdl'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      m.innerHTML = '<div class="hc-mdl-bg" data-hc-close></div><div class="hc-mdl-card"><div class="hc-mdl-top" id="hcTop"></div><div class="hc-mdl-body" id="hcBody"></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', onModalClick);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }
    return m;
  }
  function show(top, body) {
    var m = modal();
    document.getElementById('hcTop').innerHTML = top + '<button type="button" class="hc-x" data-hc-close aria-label="Close">✕</button>';
    document.getElementById('hcBody').innerHTML = body;
    m.classList.add('on'); document.body.style.overflow = 'hidden';
    m.querySelector('.hc-mdl-card').scrollTop = 0;
  }
  function close() { var m = document.getElementById('hcMdl'); if (m) m.classList.remove('on'); document.body.style.overflow = ''; }
  function topFor(c, sub) { return logo(c.name, 'hc-logo') + '<small>' + esc(sub) + '</small><h3>' + esc(c.name) + '</h3>'; }
  function refreshAll() { return load().then(function () { renderCards(); renderCalendar(); renderBoards(); }); }

  // Challenge overview: details, my team, the qualifier slots to book.
  function openChallenge(id) {
    var c = S.byId[id]; if (!c) return;
    var slots = S.slots.filter(function (x) { return x.c.id === c.id && !x.final; });
    var fin = S.slots.filter(function (x) { return x.c.id === c.id && x.final; })[0];
    var mine = c.my_entry;
    var body = (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
      '<div class="hc-info">' + (c.qualifier_start ? '<div><h5>Qualifiers</h5><p>' + dayLabel(c.qualifier_start) + ' – ' + dayLabel(c.qualifier_end) + '</p></div>' : '') +
      (c.final_date ? '<div><h5>Final</h5><p>' + dayLabel(c.final_date) + '</p></div>' : '') +
      '<div><h5>Format</h5><p>' + esc(kindLabel(c)) + '</p></div>' +
      (c.finals_cut_enabled ? '<div><h5>Finals cut</h5><p>Top ' + c.finals_cut + (c.kind === 'team' ? (c.finals_cut === 1 ? ' team' : ' teams') : c.split_gender ? ' per category' : '') + '</p></div>' : '') + '</div>' +
      (mine && mine.team ? teamBox(c, mine.team) : '') +
      (c.kind === 'team' && !(mine && mine.team) ? '<p><b>How team registration works:</b> the captain picks a slot, names the team and gets an invite link to share. Teammates open the link, join and book the same slot.</p>' : '') +
      '<div class="hc-slots"><h5 style="margin:6px 0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6f6f6f">Qualifier slots — one per day</h5>' +
      (slots.length ? slots.map(function (x) { return '<button type="button" data-hc-slot="' + esc(x.s.id) + '"><b>' + whenLong(x.s.scheduled_at) + '</b><span>' + (+x.s.registrations_count || 0) + (x.s.capacity ? ' / ' + x.s.capacity : '') + ' booked</span></button>'; }).join('')
        : '<p class="hc-note" style="text-align:left">Qualifier slots open soon.</p>') + '</div>' +
      (fin ? '<p class="hc-note" style="text-align:left">🏆 Final: ' + whenLong(fin.s.scheduled_at) + ' — qualified athletes only.</p>' : '') +
      (c.charity_enabled ? '<p class="hc-note" style="text-align:left">💚 This challenge supports ' + esc(c.charity_name) + '.</p>' : '');
    show(topFor(c, kindLabel(c)), body);
  }
  function teamBox(c, t) {
    var url = t.invite_url || (location.origin + '/30x30-hub?team=' + encodeURIComponent(t.invite_code || ''));
    return '<div class="hc-box"><h4>' + (t.is_captain ? '👑 ' : '') + 'Your team: ' + esc(t.name) + '</h4>' +
      '<p style="margin:0 0 6px">' + (t.members || 1) + ' of ' + c.team_max + ' members' + ((t.members || 1) < c.team_min ? ' · needs ' + (c.team_min - (t.members || 1)) + ' more to compete' : ' · ready') + '</p>' +
      (t.invite_code ? '<div class="hc-link">' + esc(url) + '</div><div class="hc-share"><a class="hc-btn green" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent('Join my team "' + t.name + '" for the ' + c.name + ' at the DIC 30x30 Fitness Hub 💪\n' + url) + '">Share on WhatsApp</a><button type="button" class="hc-btn line" data-hc-copy="' + esc(url) + '">Copy link</button></div>' : '') +
      '</div>';
  }

  // Slot: book it (individual / teammate), create a team (captain), or explain the final.
  function openSlot(id) {
    var x = slotById(id); if (!x) { toast('That slot isn’t available any more.'); return; }
    var c = x.c, s = x.s;
    var info = '<div class="hc-info"><div><h5>When</h5><p>' + whenLong(s.scheduled_at) + '</p></div><div><h5>Where</h5><p>' + esc(s.location || 'DIC Amphitheatre') + '</p></div>' +
      '<div><h5>Format</h5><p>' + esc(kindLabel(c)) + '</p></div><div><h5>Price</h5><p>Free</p></div></div>';
    if (x.final) {
      show(topFor(c, 'Final · ' + kindLabel(c)), info + '<p>The final is for ' + (c.finals_cut_enabled ? 'the top ' + c.finals_cut + (c.kind === 'team' ? ' teams' : ' athletes' + (c.split_gender ? ' in each category' : '')) : 'qualified athletes') +
        ' from the qualifiers — registration for the final itself isn’t open. Book a qualifier slot to compete.</p><button type="button" class="hc-btn" data-hc-ch="' + esc(c.id) + '">See qualifier slots</button>');
      return;
    }
    show(topFor(c, (c.kind === 'team' ? 'Team qualifier' : 'Qualifier') + ' · 30x30 Challenge Series'), info + (c.description ? '<p>' + esc(c.description) + '</p>' : '') + '<div id="hcAct"><p class="hc-note">Checking…</p></div>');
    var act = document.getElementById('hcAct');
    if (!token()) {
      act.innerHTML = '<button type="button" class="hc-btn" id="hcSignIn">Sign in to register — it’s free</button><p class="hc-note">New to ATP? Joining takes a minute — then you come straight back here.</p>';
      document.getElementById('hcSignIn').addEventListener('click', function () {
        close(); signIn(function () { refreshAll().then(function () { openSlot(id); }); }, location.pathname + '?slot=' + encodeURIComponent(id) + '#challenges');
      });
      return;
    }
    api('/sessions/' + encodeURIComponent(s.id)).then(function (r) {
      var mb = r.data && r.data.myBooking;
      if (mb && mb.status !== 'cancelled' && mb.status !== 'pending_payment') { bookedView(c, s, mb.qr_token); return; }
      var mine = c.my_entry;
      if (c.kind === 'team' && !(mine && mine.team)) { teamCreateView(c, s); return; }
      act.innerHTML = (mine && mine.team ? teamBox(c, mine.team) : '') +
        '<label class="hc-tc"><input type="checkbox" id="hcTc"> <span>I’m fit to take part and agree to the <a href="/terms" target="_blank" rel="noopener">terms &amp; conditions</a>.</span></label>' +
        '<button type="button" class="hc-btn" id="hcGo" disabled>' + (mine && mine.team ? 'Book this slot for me' : 'Register — book this slot') + '</button><div class="hc-err" id="hcErr"></div><p class="hc-note">One slot per day. Every attempt counts — your best result ranks.</p>';
      var tc = document.getElementById('hcTc'), go = document.getElementById('hcGo');
      tc.addEventListener('change', function () { go.disabled = !tc.checked; });
      go.addEventListener('click', function () { book(c, s, go); });
    });
  }
  function book(c, s, btn) {
    btn.disabled = true;
    return api('/bookings', { method: 'POST', body: { session_id: s.id } }).then(function (b) {
      if (b.status === 201 || (b.status === 409 && /already have a booking/i.test((b.data && b.data.error) || ''))) {
        toast('Registered — it’s in your ATP app too');
        return refreshAll().then(function () { bookedView(S.byId[c.id] || c, s, b.data && b.data.qrToken, true); });
      }
      if (b.status === 202 && b.data && b.data.status === 'waitlisted') { document.getElementById('hcAct').innerHTML = '<div class="hc-box"><h4>You’re on the waitlist</h4><p style="margin:0">Position #' + b.data.position + '. We’ll let you know in the ATP app if a spot opens.</p></div>'; return; }
      if (b.status === 401) { close(); signIn(function () { refreshAll().then(function () { openSlot(s.id); }); }); return; }
      btn.disabled = false;
      var e = document.getElementById('hcErr'); if (e) e.textContent = (b.data && b.data.error) || 'Registration failed — please try again.';
    });
  }
  function bookedView(c, s, qr, fresh) {
    var act = document.getElementById('hcAct'); if (!act) return;
    var mine = c.my_entry;
    act.innerHTML = '<div style="text-align:center"><div class="hc-ok">✓</div><h3 style="margin:0 0 4px;font-size:20px;color:#222">You’re registered</h3><p>Show this QR code at the ' + esc(c.name) + ' station. It’s also in the ATP app under My bookings.</p>' +
      (qr ? '<img class="hc-qr" alt="Check-in QR code" src="/api/bookings/qr/' + encodeURIComponent(qr) + '.png">' : '') + '</div>' +
      (mine && mine.team ? teamBox(c, mine.team) : '') + '<div id="hcCharity"></div>';
    if (c.charity_enabled && mine && !mine.donation_choice) charityAsk(c);
  }
  function charityAsk(c) {
    var el = document.getElementById('hcCharity'); if (!el) return;
    el.innerHTML = '<div class="hc-box" style="border-color:#bfe5cc;background:#f3fbf5"><h4>💚 Support ' + esc(c.charity_name) + '?</h4>' +
      (c.charity_description ? '<p style="margin:0 0 8px">' + esc(c.charity_description) + '</p>' : '') +
      '<p style="margin:0 0 10px;font-size:13px">Totally optional. You donate on ' + esc(c.charity_name) + '’s own page.</p>' +
      '<div class="hc-share"><a class="hc-btn green" id="hcDonate" href="' + esc(c.charity_url) + '" target="_blank" rel="noopener">Donate ↗</a><button type="button" class="hc-btn line" id="hcNoDonate">Not now</button></div></div>';
    var answer = function (choice) {
      api('/hub-challenges/' + encodeURIComponent(c.id) + '/donation', { method: 'POST', body: { choice: choice } });
      if (c.my_entry) c.my_entry.donation_choice = choice;
      el.innerHTML = '<p class="hc-note">' + (choice === 'yes' ? '💚 Thank you for supporting ' + esc(c.charity_name) + '!' : 'No problem — have a great challenge!') + '</p>';
    };
    document.getElementById('hcDonate').addEventListener('click', function () { answer('yes'); });
    document.getElementById('hcNoDonate').addEventListener('click', function () { answer('no'); });
  }
  function teamCreateView(c, s) {
    var act = document.getElementById('hcAct');
    act.innerHTML = '<div class="hc-box"><h4>Register your team</h4><p style="margin:0 0 6px">You’ll be the captain. Teams of ' + (c.team_min === c.team_max ? c.team_max : c.team_min + '–' + c.team_max) + ' members — you’ll get a link to invite your teammates to this slot.</p>' +
      '<input class="hc-in" id="hcTeamName" maxlength="40" placeholder="Team name"><label class="hc-tc"><input type="checkbox" id="hcTc"> <span>I’m fit to take part and agree to the <a href="/terms" target="_blank" rel="noopener">terms &amp; conditions</a>.</span></label>' +
      '<button type="button" class="hc-btn" id="hcCreate">Create team &amp; book this slot</button><div class="hc-err" id="hcErr"></div></div>' +
      '<p class="hc-note">Got an invite link from your captain? Open it to join their team.</p>';
    document.getElementById('hcCreate').addEventListener('click', function () {
      var btn = this, name = document.getElementById('hcTeamName').value.trim(), err = document.getElementById('hcErr');
      if (!document.getElementById('hcTc').checked) { err.textContent = 'Please accept the terms first.'; return; }
      if (name.length < 2) { err.textContent = 'Give your team a name.'; return; }
      btn.disabled = true; err.textContent = '';
      api('/hub-challenges/' + encodeURIComponent(c.id) + '/teams', { method: 'POST', body: { name: name, session_id: s.id } }).then(function (r) {
        if (r.status !== 201) { btn.disabled = false; err.textContent = (r.data && r.data.error) || 'Couldn’t create the team.'; return; }
        return refreshAll().then(function () { return book(S.byId[c.id] || c, s, btn); });
      });
    });
  }

  // Team invite link: /30x30-hub?team=CODE
  function openJoin(code) {
    api('/hub-challenges/teams/' + encodeURIComponent(code)).then(function (r) {
      var t = r.data && r.data.team;
      if (r.status !== 200 || !t) { show('<small>30x30 Challenge Series</small><h3>Team link</h3>', '<p>' + esc((r.data && r.data.error) || 'This team link isn’t valid any more.') + '</p>'); return; }
      var c = S.byId[t.challenge_id] || { id: t.challenge_id, name: t.challenge_name, kind: 'team', team_min: t.team_min, team_max: t.team_max, charity_enabled: t.charity_enabled, charity_name: t.charity_name, charity_url: t.charity_url };
      var mine = r.data.mine;
      var body = '<div class="hc-box"><h4>Join “' + esc(t.name) + '”</h4><p style="margin:0">Captain: ' + esc(t.captain) + ' · ' + t.members + ' of ' + t.team_max + ' members' + (t.slot_at ? '<br>Team slot: ' + whenLong(t.slot_at) : '') + '</p></div><div id="hcAct"></div>';
      show(topFor(c, 'Team invite · 30x30 Challenge Series'), body);
      var act = document.getElementById('hcAct');
      if (mine && mine.in_this_team) { act.innerHTML = '<p>You’re already in this team.</p>' + (t.slot_session_id ? '<button type="button" class="hc-btn" data-hc-slot="' + esc(t.slot_session_id) + '">Open the team slot</button>' : ''); return; }
      if (mine && mine.in_other_team) { act.innerHTML = '<p class="hc-err">You’re already in another team for this challenge.</p>'; return; }
      if (t.full) { act.innerHTML = '<p class="hc-err">This team is full.</p>'; return; }
      if (!token()) {
        act.innerHTML = '<button type="button" class="hc-btn" id="hcSignIn">Sign in to join — it’s free</button><p class="hc-note">New to ATP? Joining takes a minute — then you come straight back here.</p>';
        document.getElementById('hcSignIn').addEventListener('click', function () { close(); signIn(function () { refreshAll().then(function () { openJoin(code); }); }, location.pathname + '?team=' + encodeURIComponent(code)); });
        return;
      }
      act.innerHTML = '<label class="hc-tc"><input type="checkbox" id="hcTc"> <span>I’m fit to take part and agree to the <a href="/terms" target="_blank" rel="noopener">terms &amp; conditions</a>.</span></label><button type="button" class="hc-btn" id="hcJoin" disabled>Join team' + (t.slot_session_id ? ' &amp; book the team slot' : '') + '</button><div class="hc-err" id="hcErr"></div>';
      var tc = document.getElementById('hcTc'), go = document.getElementById('hcJoin');
      tc.addEventListener('change', function () { go.disabled = !tc.checked; });
      go.addEventListener('click', function () {
        go.disabled = true;
        api('/hub-challenges/teams/' + encodeURIComponent(code) + '/join', { method: 'POST' }).then(function (j) {
          if (j.status !== 201 && j.status !== 200) { go.disabled = false; document.getElementById('hcErr').textContent = (j.data && j.data.error) || 'Couldn’t join the team.'; return; }
          toast('You joined ' + t.name);
          refreshAll().then(function () {
            var x = t.slot_session_id && slotById(t.slot_session_id);
            if (x) { openSlot(x.s.id); var g2 = document.getElementById('hcGo'); }
            else { act.innerHTML = '<p>You’re in! Your captain will pick the slot — open the challenge to book it.</p><button type="button" class="hc-btn" data-hc-ch="' + esc(c.id) + '">Open the challenge</button>'; }
          });
        });
      });
    });
  }

  // ── events ────────────────────────────────────────────────────
  function onModalClick(e) {
    if (e.target.closest('[data-hc-close]')) { close(); return; }
    var cp = e.target.closest('[data-hc-copy]');
    if (cp) { var v = cp.getAttribute('data-hc-copy'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Invite link copied'); }, function () { toast('Copy failed — long-press the link to copy'); }); return; }
    var sl = e.target.closest('[data-hc-slot]'); if (sl) { openSlot(sl.getAttribute('data-hc-slot')); return; }
    var ch = e.target.closest('[data-hc-ch]'); if (ch) { openChallenge(ch.getAttribute('data-hc-ch')); return; }
  }
  function onPageClick(e) {
    var t = e.target.closest('[data-hc-cat],[data-hc-week],[data-hc-slot],[data-hc-ch],[data-hc-board],[data-hc-stage]');
    if (!t || t.closest('#hcMdl')) return;
    if (t.hasAttribute('data-hc-cat')) { S.cat = t.getAttribute('data-hc-cat'); S.week = null; renderCalendar(); return; }
    if (t.hasAttribute('data-hc-week')) { S.week = +t.getAttribute('data-hc-week'); renderCalendar(); return; }
    if (t.hasAttribute('data-hc-slot')) { openSlot(t.getAttribute('data-hc-slot')); return; }
    if (t.hasAttribute('data-hc-ch')) { openChallenge(t.getAttribute('data-hc-ch')); return; }
    if (t.hasAttribute('data-hc-board')) { S.boardCh = t.getAttribute('data-hc-board'); renderBoards(); return; }
    if (t.hasAttribute('data-hc-stage')) { S.boardStage = t.getAttribute('data-hc-stage'); renderBoards(); }
  }

  var _bound = false;
  function mount(opts) {
    css();
    S.el = { cards: opts.cards || null, calendar: opts.calendar || null, boards: opts.boards || null };
    [S.el.cards, S.el.calendar, S.el.boards].forEach(function (el) { if (el) el.classList.add('hc-wrap'); });
    if (!_bound) { document.addEventListener('click', onPageClick); _bound = true; window.addEventListener('atp:login', function () { refreshAll(); }); }
    renderCards(); renderCalendar(); renderBoards();
    return refreshAll().then(function () {
      var p = new URLSearchParams(location.search);
      if (p.get('team')) openJoin(p.get('team'));
      else if (p.get('slot')) openSlot(p.get('slot'));
      else if (p.get('challenge') && S.byId[p.get('challenge')]) openChallenge(p.get('challenge'));
    });
  }
  window.HubCh = { mount: mount, refresh: refreshAll, openChallenge: openChallenge, openSlot: openSlot, openJoin: openJoin, state: S };
})();
