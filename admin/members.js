/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Members list (server-side paging, search, sort, filters)
 * + member detail drawer + CSV export.
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ── MEMBERS ───────────────────────────────────────────────────
// Founder 2026-10-06: "I can't see all 8046 members". The tab fetched
// `limit=100` once with no paging, so only the 100 newest members were
// ever reachable (search was the only way to anyone older), and banned
// / deleted accounts were silently left out of the total. Everything
// below is server-side: the API pages, searches, sorts and filters
// across every member — nothing is filtered in the browser.
var MEMBERS_STATE = { offset: 0, limit: 50, sort: 'joined', dir: 'desc', total: 0 };
var _membersReq = 0;        // only the latest response renders (typing, double tab-load)
var _membersFiltersReady = false;
var _mDrawerId = null;      // member open in the detail drawer

// Legacy entry point — kept because older call sites still use it.
function renderMembers() { loadMembersAPI(); }

var _searchTimer = null;
function filterMembers(q) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() { MEMBERS_STATE.offset = 0; loadMembersAPI(); }, 350);
}
function membersFilterChanged() { MEMBERS_STATE.offset = 0; loadMembersAPI(); }
function resetMemberFilters() {
  ['memberSearch', 'mfPlan', 'mfRole', 'mfTribe', 'mfCity'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var st = document.getElementById('mfStatus'); if (st) st.value = 'all';
  MEMBERS_STATE.offset = 0;
  loadMembersAPI();
}
function sortMembers(key) {
  if (MEMBERS_STATE.sort === key) MEMBERS_STATE.dir = MEMBERS_STATE.dir === 'desc' ? 'asc' : 'desc';
  else { MEMBERS_STATE.sort = key; MEMBERS_STATE.dir = key === 'name' ? 'asc' : 'desc'; }
  MEMBERS_STATE.offset = 0;
  loadMembersAPI();
}
function membersGoToPage(p) {
  var pages = Math.max(1, Math.ceil(MEMBERS_STATE.total / MEMBERS_STATE.limit));
  p = Math.min(pages, Math.max(1, parseInt(p, 10) || 1));
  MEMBERS_STATE.offset = (p - 1) * MEMBERS_STATE.limit;
  loadMembersAPI();
}
function membersSetPageSize(n) {
  MEMBERS_STATE.limit = parseInt(n, 10) || 50;
  MEMBERS_STATE.offset = 0;
  loadMembersAPI();
}

// ── helpers ──
function _mEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function _mDate(d, withTime) {
  if (!d) return '—';
  var dt = new Date(d);
  if (isNaN(dt)) return _mEsc(d);
  var o = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
  return dt.toLocaleDateString('en-GB', o);
}
function _mAgo(d) {
  if (!d) return '—';
  var days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (isNaN(days)) return '—';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 60) return days + 'd ago';
  return _mDate(d);
}
function _mNum(n) { return (Number(n) || 0).toLocaleString('en-GB'); }
var _M_STATUS = {
  active:           ['Active', 'badge-green'],
  banned:           ['Banned', 'badge-red'],
  pending_deletion: ['Deleting', 'badge-gold'],
  deleted:          ['Deleted', 'badge-grey'],
};
function _mStatusBadge(s) {
  var b = _M_STATUS[s] || _M_STATUS.active;
  return '<span class="badge ' + b[1] + '">' + b[0] + '</span>';
}
function _mRoleBadges(m) {
  var out = '';
  if (m.is_admin) out += ' <span class="badge m-badge-admin">Admin</span>';
  if (m.is_coach) out += ' <span class="badge badge-green">Coach</span>';
  if (m.is_ambassador) out += ' <span class="badge badge-gold">Ambassador</span>';
  return out;
}
function _mTribeChip(name, color) {
  if (!name) return '<span class="m-muted">—</span>';
  var c = /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '#888';
  return '<span class="m-tribe"><i style="background:' + c + '"></i>' + _mEsc(name) + '</span>';
}

function _membersQuery() {
  var v = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  var qs = [];
  var q = (v('memberSearch') || '').trim();
  if (q) qs.push('search=' + encodeURIComponent(q));
  qs.push('status=' + encodeURIComponent(v('mfStatus') || 'all'));
  if (v('mfPlan')) qs.push('subscription_type=' + encodeURIComponent(v('mfPlan')));
  var role = v('mfRole');
  if (role) qs.push('is_' + role + '=true');
  if (v('mfTribe')) qs.push('tribe_id=' + encodeURIComponent(v('mfTribe')));
  if (v('mfCity')) qs.push('city_id=' + encodeURIComponent(v('mfCity')));
  qs.push('sort=' + MEMBERS_STATE.sort, 'dir=' + MEMBERS_STATE.dir);
  return qs.join('&');
}
function _membersFiltered() {
  return ['memberSearch', 'mfPlan', 'mfRole', 'mfTribe', 'mfCity'].some(function(id) {
    var el = document.getElementById(id); return el && el.value;
  }) || ((document.getElementById('mfStatus') || {}).value || 'all') !== 'all';
}

// Tribe + city dropdowns, filled once from the public lists.
function _membersInitFilters() {
  if (_membersFiltersReady) return;
  _membersFiltersReady = true;
  fetch(ATP_API + '/sessions/tribes').then(function(r) { return r.json(); }).then(function(d) {
    var sel = document.getElementById('mfTribe'); if (!sel) return;
    (d.tribes || []).forEach(function(t) {
      sel.insertAdjacentHTML('beforeend', '<option value="' + _mEsc(t.id) + '">' + _mEsc(t.name) + '</option>');
    });
  }).catch(function() {});
  fetch(ATP_API + '/cities').then(function(r) { return r.json(); }).then(function(d) {
    var sel = document.getElementById('mfCity'); if (!sel) return;
    (d.cities || []).forEach(function(c) {
      sel.insertAdjacentHTML('beforeend', '<option value="' + _mEsc(c.id) + '">' + _mEsc(c.name) + (c.country ? ' · ' + _mEsc(c.country) : '') + '</option>');
    });
  }).catch(function() {});
}

async function loadMembersAPI() {
  var token = getToken();
  if (!token) return;
  _membersInitFilters();
  var S = MEMBERS_STATE;
  var reqId = ++_membersReq;
  var tbody = document.getElementById('membersTbody');
  if (tbody && !tbody.children.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="m-empty">Loading members…</td></tr>';
  }
  var table = document.getElementById('membersTable');
  if (table) table.style.opacity = '0.55';
  var url = ATP_API + '/admin/members?' + _membersQuery() + '&limit=' + S.limit + '&offset=' + S.offset;
  try {
    var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    var data = await res.json();
    if (reqId !== _membersReq) return; // a newer request is in flight
    if (!res.ok || !data.members) throw new Error(data.error || ('HTTP ' + res.status));
    S.total = data.total || 0;
    // Filter shrank the result below the current page → show the last page.
    if (!data.members.length && S.total > 0 && S.offset > 0) {
      S.offset = Math.floor((S.total - 1) / S.limit) * S.limit;
      return loadMembersAPI();
    }
    MEMBERS_DATA = data.members; // keep in sync with legacy
    if (!tbody) return;
    tbody.innerHTML = data.members.length
      ? data.members.map(_memberRow).join('')
      : '<tr><td colspan="12" class="m-empty">No members match these filters.</td></tr>';
    _renderMembersMeta(data);
    if (_mDrawerId) openMemberDetail(_mDrawerId, true);
  } catch (e) {
    if (reqId !== _membersReq) return;
    console.warn('loadMembersAPI:', e.message);
    if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="m-empty" style="color:#f87171">Could not load members: ' + _mEsc(e.message) + '</td></tr>';
  } finally {
    if (table && reqId === _membersReq) table.style.opacity = '';
  }
}

function _memberRow(m) {
  var name = ((m.first_name || '') + ' ' + (m.last_name || '')).trim() || 'Unknown';
  var ini = (((m.first_name || '?')[0] || '?') + ((m.last_name || '?')[0] || '?')).toUpperCase();
  var id = _mEsc(m.id);
  var label = _mEsc(name);
  // Theme 13 — inline tier dropdown so admins can comp/upgrade members
  // without going through Stripe. Active Stripe subs will overwrite
  // this on the next webhook event; that's fine.
  var tier = (m.subscription_type || 'free').toLowerCase();
  var tierSelect =
    '<select onchange="setMemberTier(this.dataset.mid, this.value, this)" data-mid="' + id + '" ' +
            'style="background:#0a0a0a;border:1px solid #1a1a1a;color:' +
            (tier === 'premium_plus' ? '#ffc400' : (tier === 'premium' ? '#A8FF00' : '#888')) +
            ';font-size:11px;padding:4px 8px;border-radius:6px;font-weight:700;cursor:pointer">' +
      '<option value="free"' +         (tier === 'free'         ? ' selected' : '') + '>Free</option>' +
      '<option value="premium"' +      (tier === 'premium'      ? ' selected' : '') + '>⭐ Premium</option>' +
      '<option value="premium_plus"' + (tier === 'premium_plus' ? ' selected' : '') + '>⭐⭐ Premium+</option>' +
    '</select>' +
    (m.subscription_status ? '<div class="m-sub">' + _mEsc(m.subscription_status) + '</div>' : '');
  var walletBal = m.wallet_balance_aed || 0;
  var walletPending = m.wallet_pending_aed || 0;
  var walletDisplay = '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:' + (walletBal > 0 ? '#f5c042' : '#555') + ';line-height:1">AED ' + _mNum(walletBal) + '</div>' +
    (walletPending > 0 ? '<div style="font-size:10px;color:#888;margin-top:1px">+' + _mNum(walletPending) + ' pending</div>' : '');
  var isAmb = m.is_ambassador;
  var roles = _mRoleBadges(m);
  return '<tr class="m-row" data-mid="' + id + '" tabindex="0" onclick="memberRowClick(event, this.dataset.mid)" onkeydown="if(event.key===\'Enter\'&&event.target===this)openMemberDetail(this.dataset.mid)">' +
    '<td class="m-sticky"><div class="m-who"><div class="admin-av">' + _mEsc(ini) + '</div>' +
      '<div><button type="button" class="m-name" onclick="openMemberDetail(this.dataset.mid)" data-mid="' + id + '">' + label + '</button>' +
      '<div class="admin-member-email">' + _mEsc(m.member_number || '—') + '</div></div></div></td>' +
    '<td><div class="m-email">' + _mEsc(m.email || '—') + (m.email_verified ? ' <span title="Email verified" style="color:#A8FF00">✓</span>' : '') + '</div>' +
      '<div class="m-sub">' + _mEsc(m.phone || 'No phone') + '</div></td>' +
    '<td>' + _mTribeChip(m.tribe_name, m.tribe_color) + '</td>' +
    '<td class="m-city">' + (m.city_name ? _mEsc(m.city_name) : '<span class="m-muted">—</span>') +
      (m.residence_city && m.residence_city !== m.city_name ? '<div class="m-sub">lives: ' + _mEsc(m.residence_city) + '</div>' : '') + '</td>' +
    '<td>' + tierSelect + '</td>' +
    '<td><div class="m-badges">' + _mStatusBadge(m.account_status) + roles + '</div></td>' +
    '<td class="m-nowrap">' + _mDate(m.joined_at) + '</td>' +
    '<td class="m-nowrap">' + _mAgo(m.last_active_at) + '</td>' +
    '<td style="color:#fff;font-size:13px;font-weight:600">' + _mNum(m.sessions_count) + '</td>' +
    '<td style="font-size:13px;font-weight:700;color:#A8FF00">' + _mNum(m.points_balance) + '</td>' +
    '<td>' + walletDisplay + '</td>' +
    '<td class="m-nowrap">' +
      '<button class="admin-btn" style="font-size:11px;padding:4px 10px;background:rgba(245,192,66,.14);color:#f5c042;border:1px solid rgba(245,192,66,.3);margin-right:4px" onclick="topupWallet(this.dataset.mid, this.dataset.name)" data-mid="' + id + '" data-name="' + label + '">💰 Top up</button>' +
      '<button class="admin-btn" style="font-size:11px;padding:4px 10px;background:rgba(168,255,0,.14);color:#A8FF00;border:1px solid rgba(168,255,0,.3);margin-right:4px" onclick="adjustPoints(this.dataset.mid, this.dataset.name)" data-mid="' + id + '" data-name="' + label + '">± Points</button>' +
      (isAmb
        ? '<button class="admin-btn" style="font-size:11px;padding:4px 10px" onclick="removeAmbassador(this.dataset.mid)" data-mid="' + id + '">Remove Amb.</button>'
        : '<button class="admin-btn" style="font-size:11px;padding:4px 10px" onclick="makeAmbassador(this.dataset.mid)" data-mid="' + id + '">Make Amb.</button>'
      ) +
    '</td></tr>';
}

function memberRowClick(ev, id) {
  // Buttons + the tier dropdown keep their own behaviour.
  if (ev && ev.target && ev.target.closest && ev.target.closest('button,select,input,a,option')) return;
  openMemberDetail(id);
}

// Total label, status counts, sort arrows, pager.
function _renderMembersMeta(data) {
  var S = MEMBERS_STATE;
  var counts = data.status_counts;
  var all = counts ? counts.all : null;
  var lbl = document.getElementById('membersTotalLbl');
  if (lbl) {
    lbl.textContent = (!_membersFiltered() || all == null)
      ? _mNum(all == null ? S.total : all) + ' members'
      : _mNum(S.total) + ' matching · ' + _mNum(all) + ' members in total';
  }
  if (counts) {
    var st = document.getElementById('mfStatus');
    var names = { all: 'All members', active: 'Active', banned: 'Banned', pending_deletion: 'Pending deletion', deleted: 'Deleted (anonymised)' };
    if (st) Array.prototype.forEach.call(st.options, function(o) {
      if (names[o.value] && counts[o.value] != null) o.textContent = names[o.value] + ' (' + _mNum(counts[o.value]) + ')';
    });
  }
  document.querySelectorAll('#membersTable th[data-sort]').forEach(function(th) {
    var on = th.getAttribute('data-sort') === S.sort;
    th.classList.toggle('m-sorted', on);
    var arrow = th.querySelector('.m-arrow');
    if (arrow) arrow.textContent = on ? (S.dir === 'asc' ? '▲' : '▼') : '';
  });
  var pager = document.getElementById('membersPager');
  if (!pager) return;
  var pages = Math.max(1, Math.ceil(S.total / S.limit));
  var page = Math.floor(S.offset / S.limit) + 1;
  var from = S.total ? S.offset + 1 : 0;
  var to = Math.min(S.total, S.offset + S.limit);
  pager.innerHTML =
    '<span>Showing <strong>' + _mNum(from) + '–' + _mNum(to) + '</strong> of <strong>' + _mNum(S.total) + '</strong></span>' +
    '<span class="m-pager-nav">' +
      '<button class="admin-btn" onclick="membersGoToPage(1)"' + (page <= 1 ? ' disabled' : '') + ' aria-label="First page">«</button>' +
      '<button class="admin-btn" onclick="membersGoToPage(' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '>‹ Prev</button>' +
      '<label>Page <input type="number" min="1" max="' + pages + '" value="' + page + '" onchange="membersGoToPage(this.value)" aria-label="Page number"> of ' + _mNum(pages) + '</label>' +
      '<button class="admin-btn" onclick="membersGoToPage(' + (page + 1) + ')"' + (page >= pages ? ' disabled' : '') + '>Next ›</button>' +
      '<button class="admin-btn" onclick="membersGoToPage(' + pages + ')"' + (page >= pages ? ' disabled' : '') + ' aria-label="Last page">»</button>' +
    '</span>' +
    '<label>Rows per page <select onchange="membersSetPageSize(this.value)">' +
      [50, 100, 250, 500].map(function(n) { return '<option value="' + n + '"' + (n === S.limit ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
    '</select></label>';
}

// CSV of every member matching the current search + filters (all
// pages — the server ignores limit/offset for format=csv).
function exportMembersList() {
  var url = ATP_API + '/admin/members?' + _membersQuery() + '&format=csv';
  var name = 'atp-members-' + new Date().toISOString().slice(0, 10) + '.csv';
  if (typeof _downloadAuthed === 'function') return _downloadAuthed(url, name);
  window.open(url, '_blank');
}

// ── MEMBER DETAIL DRAWER ──────────────────────────────────────
// Read-only view of everything GET /api/admin/members/:id returns,
// grouped. Any member column not placed in a group below still shows
// under "Other fields", so a newly added column is never invisible.
function _mDrawerEl() {
  var el = document.getElementById('memberDrawer');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'memberDrawer';
  el.className = 'm-drawer';
  el.hidden = true;
  el.innerHTML = '<div class="m-drawer-backdrop" onclick="closeMemberDetail()"></div>' +
    '<aside class="m-drawer-panel" role="dialog" aria-modal="true" aria-label="Member details" tabindex="-1">' +
    '<div id="memberDrawerBody"></div></aside>';
  document.body.appendChild(el);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _mDrawerId) closeMemberDetail();
  });
  return el;
}
function closeMemberDetail() {
  _mDrawerId = null;
  var el = document.getElementById('memberDrawer');
  if (el) el.hidden = true;
  document.body.style.overflow = '';
}

async function openMemberDetail(id, refresh) {
  if (!id) return;
  var el = _mDrawerEl();
  var body = document.getElementById('memberDrawerBody');
  _mDrawerId = id;
  if (!refresh) {
    body.innerHTML = '<div class="m-drawer-loading">Loading member…</div>';
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    var panel = el.querySelector('.m-drawer-panel');
    if (panel) { panel.scrollTop = 0; panel.focus(); }
  }
  try {
    var res = await fetch(ATP_API + '/admin/members/' + encodeURIComponent(id), {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    });
    var d = await res.json();
    if (_mDrawerId !== id) return;
    if (!res.ok || !d.member) throw new Error(d.error || ('HTTP ' + res.status));
    body.innerHTML = _memberDetailHtml(d);
  } catch (e) {
    if (_mDrawerId !== id) return;
    body.innerHTML = '<div class="m-drawer-head"><div></div><button class="admin-btn" onclick="closeMemberDetail()">✕ Close</button></div>' +
      '<div class="m-drawer-loading" style="color:#f87171">Could not load member: ' + _mEsc(e.message) + '</div>';
  }
}

function _mVal(v) {
  if (v === null || v === undefined || v === '') return '<span class="m-muted">—</span>';
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.length ? _mEsc(v.map(function(x) { return typeof x === 'object' ? JSON.stringify(x) : x; }).join(', ')) : '<span class="m-muted">—</span>';
  if (typeof v === 'object') return '<code>' + _mEsc(JSON.stringify(v)) + '</code>';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return _mDate(v, true);
  return _mEsc(v);
}
// rows: [label, html] — html is already escaped / built by the caller.
function _mGroup(title, rows) {
  return '<section class="m-group"><h4>' + _mEsc(title) + '</h4><dl>' +
    rows.map(function(r) { return '<dt>' + _mEsc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') +
    '</dl></section>';
}
function _mAge(dob) {
  if (!dob) return '';
  var b = new Date(dob);
  if (isNaN(b)) return '';
  var now = new Date();
  var a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return ' <span class="m-muted">(' + a + ')</span>';
}
function _mWhen(at, by) {
  if (!at) return '';
  return ' <span class="m-muted">since ' + _mDate(at) + (by ? ' by ' + _mEsc(by) : '') + '</span>';
}

function _memberDetailHtml(d) {
  var m = d.member;
  var used = {};
  var f = function(k) { used[k] = 1; return m[k]; };
  var v = function(k) { return _mVal(f(k)); };
  var mark = function() { for (var i = 0; i < arguments.length; i++) used[arguments[i]] = 1; };
  mark('tribe_id', 'tribe_name', 'tribe_color', 'city_id', 'country_id',
       'is_banned', 'banned_at', 'banned_reason', 'pending_deletion_at', 'account_status',
       'welcome_discount_pct', 'welcome_discount_issued_at', 'welcome_discount_used_at', 'welcome_discount_expires_at',
       'ambassador_activated_at', 'ambassador_activated_by', 'ambassador_activated_by_name',
       'coach_activated_at', 'coach_activated_by', 'coach_activated_by_name');
  var name = ((m.first_name || '') + ' ' + (m.last_name || '')).trim() || 'Unknown';
  var ini = (((m.first_name || '?')[0] || '?') + ((m.last_name || '?')[0] || '?')).toUpperCase();
  var av = f('avatar_url');
  var avatar = (typeof av === 'string' && /^(https?:\/\/|data:image\/)/i.test(av))
    ? '<img class="m-drawer-av" src="' + _mEsc(av) + '" alt="">'
    : '<div class="m-drawer-av">' + _mEsc(ini) + '</div>';
  var gallery = f('avatar_gallery');
  var st = d.stats || {};
  var sub = d.subscription;
  var wallet = d.wallet || {};
  var label = _mEsc(name);
  var id = _mEsc(m.id);

  var head =
    '<div class="m-drawer-head">' +
      '<div class="m-who">' + avatar + '<div>' +
        '<div class="m-drawer-name">' + label + '</div>' +
        '<div class="admin-member-email">' + _mEsc(m.member_number || '') + ' · ' + _mEsc(m.email || '') + '</div>' +
        '<div style="margin-top:6px">' + _mStatusBadge(m.account_status) + ' ' + _mRoleBadges(m) + '</div>' +
      '</div></div>' +
      '<button class="admin-btn" onclick="closeMemberDetail()" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="m-drawer-actions">' +
      '<button class="admin-btn" onclick="topupWallet(this.dataset.mid, this.dataset.name)" data-mid="' + id + '" data-name="' + label + '">💰 Top up wallet</button>' +
      '<button class="admin-btn" onclick="adjustPoints(this.dataset.mid, this.dataset.name)" data-mid="' + id + '" data-name="' + label + '">± Points</button>' +
      (m.is_ambassador
        ? '<button class="admin-btn" onclick="removeAmbassador(this.dataset.mid)" data-mid="' + id + '">Remove Ambassador</button>'
        : '<button class="admin-btn" onclick="makeAmbassador(this.dataset.mid)" data-mid="' + id + '">Make Ambassador</button>') +
    '</div>';

  var sports = f('sports_preferences');
  var profile = _mGroup('Profile', [
    ['First name', v('first_name')],
    ['Last name', v('last_name')],
    ['Date of birth', (m.date_of_birth ? _mDate(f('date_of_birth')) + _mAge(m.date_of_birth) : v('date_of_birth'))],
    ['Gender', v('gender')],
    ['Nationality', v('nationality')],
    ['Lives in', _mVal([f('residence_city'), f('residence_country')].filter(Boolean).join(', '))],
    ['Tribe', _mTribeChip(m.tribe_name, m.tribe_color)],
    ['Favourite sports', _mVal(Array.isArray(sports) ? sports : (sports ? [sports] : []))],
    ['Top / bottom size', _mVal([f('top_size'), f('bottom_size')].map(function(x) { return x || '—'; }).join(' / '))],
    ['Padel level', v('padel_level')],
    ['Volleyball level', v('volleyball_level')],
    ['Profile complete', _mVal(m.profile_complete_pct != null ? f('profile_complete_pct') + '%' : f('profile_complete_pct'))],
    ['Timezone', v('timezone')],
    ['Photos in gallery', _mVal(Array.isArray(gallery) ? gallery.length : 0)],
  ]);

  var contact = _mGroup('Contact', [
    ['Email', v('email') + (m.email ? (f('email_verified') ? ' <span class="badge badge-green">Verified</span>' : ' <span class="badge badge-grey">Not verified</span>') : '')],
    ['Phone', v('phone')],
    ['City (operating)', v('city_name')],
    ['Country (operating)', v('country_name')],
  ]);

  var billing = _mGroup('Membership & billing', [
    ['Plan', v('subscription_type')],
    ['Subscription status', v('subscription_status')],
    ['Renews', v('subscription_renews_at')],
    ['Ends', v('subscription_ends')],
    ['Stripe customer', v('stripe_customer_id')],
    ['Latest subscription', sub
      ? _mEsc(sub.plan_name || 'Plan') + ' · ' + _mEsc(sub.status) +
        (sub.current_period_end ? ' · period ends ' + _mDate(sub.current_period_end) : '') +
        (sub.cancel_at_period_end ? ' · <span style="color:#f5c042">cancels at period end</span>' : '') +
        (sub.cancelled_at ? ' · cancelled ' + _mDate(sub.cancelled_at) : '') +
        (sub.stripe_subscription_id ? '<div class="m-sub">' + _mEsc(sub.stripe_subscription_id) + '</div>' : '')
      : _mVal(null)],
    ['Wallet', 'AED ' + _mNum(wallet.balance_aed) + (wallet.pending_aed ? ' <span class="m-muted">(+' + _mNum(wallet.pending_aed) + ' pending)</span>' : '')],
    ['Points balance', '<strong style="color:#A8FF00">' + _mNum(f('points_balance')) + '</strong>'],
    ['Welcome discount', m.welcome_discount_code
      ? _mEsc(f('welcome_discount_code')) + (m.welcome_discount_pct ? ' · ' + _mEsc(m.welcome_discount_pct) + '%' : '') +
        (m.welcome_discount_issued_at ? ' · issued ' + _mDate(m.welcome_discount_issued_at) : '') +
        (m.welcome_discount_used_at ? ' · used ' + _mDate(m.welcome_discount_used_at) : (m.welcome_discount_expires_at ? ' · expires ' + _mDate(m.welcome_discount_expires_at) : ''))
      : _mVal(f('welcome_discount_code'))],
  ]);

  var ref = d.referred_by;
  var activity = _mGroup('Activity', [
    ['Joined', v('joined_at')],
    ['Last active', v('last_active_at')],
    ['Last session', v('last_session_at')],
    ['Sessions attended', '<strong>' + _mNum(st.attended) + '</strong>'],
    ['Bookings', _mNum(st.bookings) + ' total · ' + _mNum(st.upcoming) + ' upcoming · ' + _mNum(st.no_show) + ' no-show · ' + _mNum(st.cancelled) + ' cancelled'],
    ['First / last check-in', _mDate(st.first_checkin_at) + ' / ' + _mDate(st.last_checkin_at)],
    ['Referral code', v('referral_code')],
    ['Referred by', ref ? _mEsc(((ref.first_name || '') + ' ' + (ref.last_name || '')).trim()) + ' <span class="m-muted">' + _mEsc(ref.member_number || '') + ' · ' + _mDate(ref.created_at) + '</span>' : _mVal(null)],
    ['Members referred', _mNum(d.referrals_count)],
  ]);
  var bookings = (d.recent_bookings || []).length
    ? '<table class="m-mini"><tr><th>Session</th><th>Date</th><th>Status</th></tr>' + d.recent_bookings.map(function(b) {
        return '<tr><td>' + _mEsc(b.session_name) + '</td><td class="m-nowrap">' + _mDate(b.scheduled_at) + '</td><td>' + _mEsc(b.status) + '</td></tr>';
      }).join('') + '</table>'
    : '<div class="m-muted" style="font-size:12px">No bookings yet.</div>';
  var points = (d.recent_points || []).length
    ? '<table class="m-mini"><tr><th>When</th><th>Points</th><th>Reason</th></tr>' + d.recent_points.map(function(p) {
        return '<tr><td class="m-nowrap">' + _mDate(p.created_at) + '</td><td style="color:' + (p.amount < 0 ? '#f87171' : '#A8FF00') + '">' + (p.amount > 0 ? '+' : '') + _mNum(p.amount) + '</td><td>' + _mEsc(p.description || p.reason) + '</td></tr>';
      }).join('') + '</table>'
    : '<div class="m-muted" style="font-size:12px">No points activity.</div>';
  activity += '<section class="m-group"><h4>Recent bookings</h4>' + bookings + '</section>' +
              '<section class="m-group"><h4>Recent points</h4>' + points + '</section>';

  var statusDetail = { active: 'Active', banned: 'Banned', pending_deletion: 'Pending deletion', deleted: 'Deleted (anonymised)' }[m.account_status] || 'Active';
  if (m.account_status === 'banned' || m.account_status === 'deleted') {
    statusDetail += (m.banned_at ? ' · ' + _mDate(m.banned_at) : '') + (m.banned_reason ? '<div class="m-sub">' + _mEsc(m.banned_reason) + '</div>' : '');
  }
  if (m.pending_deletion_at) {
    var anonAt = new Date(new Date(m.pending_deletion_at).getTime() + 30 * 86400000);
    statusDetail += '<div class="m-sub">Requested ' + _mDate(m.pending_deletion_at) + ' · anonymises ' + _mDate(anonAt) + '</div>';
  }
  var roles = _mGroup('Roles & status', [
    ['Account status', statusDetail],
    ['Admin', v('is_admin')],
    ['Ambassador', v('is_ambassador') + (m.is_ambassador ? _mWhen(m.ambassador_activated_at, m.ambassador_activated_by_name) : '')],
    ['Coach', v('is_coach') + (m.is_coach ? _mWhen(m.coach_activated_at, m.coach_activated_by_name) : '')],
  ]);

  var methods = [];
  if (f('has_password')) methods.push('Email + password');
  (d.auth_providers || []).forEach(function(p) {
    methods.push(_mEsc(p.provider.charAt(0).toUpperCase() + p.provider.slice(1)) + (p.email && p.email !== m.email ? ' <span class="m-muted">(' + _mEsc(p.email) + ')</span>' : ''));
  });
  var push = (d.push_devices || []).map(function(p) {
    return _mEsc(p.platform) + ' ×' + p.devices + ' <span class="m-muted">(' + _mAgo(p.last_seen_at) + ')</span>';
  });
  var account = _mGroup('Account', [
    ['Member number', v('member_number')],
    ['Member ID', '<code>' + _mEsc(f('id')) + '</code>'],
    ['Sign-in methods', methods.length ? methods.join('<br>') : 'Magic link only'],
    ['Push notifications', push.length ? push.join('<br>') : '<span class="m-muted">No registered device</span>'],
    ['Imported from old site', v('migrated_from_csv')],
    ['Created', v('created_at')],
    ['Last updated', v('updated_at')],
  ]);

  // Everything else on the members row — nothing is hidden.
  var rest = Object.keys(m).filter(function(k) { return !used[k]; }).sort();
  var other = rest.length
    ? _mGroup('Other fields', rest.map(function(k) { return [k.replace(/_/g, ' '), _mVal(m[k])]; }))
    : '';

  return head + '<div class="m-drawer-groups">' + profile + contact + billing + activity + roles + account + other + '</div>';
}
