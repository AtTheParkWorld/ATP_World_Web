/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Ambassadors list + add/revoke
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ── AMBASSADORS ───────────────────────────────────────────────
async function loadAmbassadorsAPI() {
  loadAmbSchedule(_ambSched.day);
  loadAmbOverview();
  return renderAmbassadors();
}
async function renderAmbassadors() {
  var tbody = document.getElementById('ambassadorTbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#444;padding:20px">Loading…</td></tr>';
  try {
    var data = await apiGet('/admin/members?is_ambassador=true&limit=200');
    var ambs = data.members || [];
    if (!ambs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#444;padding:20px">No ambassadors yet — go to Members and activate some</td></tr>';
      return;
    }
    tbody.innerHTML = ambs.map(function(m) {
      var name = ((m.first_name||'')+' '+(m.last_name||'')).trim();
      var ini = ((m.first_name||'?')[0]+(m.last_name||'?')[0]).toUpperCase();
      var joined = m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-GB',{month:'short',year:'numeric'}) : '—';
      var coachBtn = m.is_coach
        ? '<button class="admin-btn" style="font-size:11px;padding:4px 10px;background:#0d1a0a;color:#A8FF00;border-color:#A8FF00;margin-right:6px" onclick="toggleCoach(this.dataset.mid,false)" data-mid="'+m.id+'">🎽 Remove Coach</button>'
        : '<button class="admin-btn" style="font-size:11px;padding:4px 10px;margin-right:6px" onclick="toggleCoach(this.dataset.mid,true)" data-mid="'+m.id+'">🎽 Make Coach</button>';
      return '<tr>'+
        '<td style="display:flex;align-items:center;gap:10px"><div class="admin-av" style="background:rgba(255,196,0,.15);color:#ffc400">'+ini+'</div><div><div class="admin-member-name">'+name+'</div><div class="admin-member-email">'+m.member_number+' · '+m.email+'</div></div></td>'+
        '<td style="color:#555;font-size:12px">'+joined+'</td>'+
        '<td style="color:#A8FF00;font-weight:700">'+(m.sessions_count||0)+' sessions</td>'+
        '<td><span class="badge badge-green">Active</span>'+(m.is_coach?' <span class="badge" style="background:#0d1a0a;color:#A8FF00;border:1px solid #A8FF00">🎽 Coach</span>':'')+'</td>'+
        '<td>'+coachBtn+'<button class="admin-btn admin-btn-danger" onclick="removeAmbassador(this.dataset.mid)" data-mid="'+m.id+'" style="font-size:11px;padding:4px 10px">Revoke</button></td>'+
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#f87171;padding:20px">Error: '+e.message+'</td></tr>';
  }
}



function showAddAmbassador() {
  var form = document.getElementById('addAmbForm');
  if (form) { form.style.display = 'block'; form.scrollIntoView({behavior:'smooth'}); }
}

async function addAmbassador() {
  var input = document.getElementById('newAmbInput').value.trim();
  if (!input) { showToast('⚠️ Please enter member ID or email', true); return; }
  var token = getToken();
  try {
    // First find the member
    var search = await fetch(ATP_API + '/admin/members?search=' + encodeURIComponent(input), {
      headers:{'Authorization':'Bearer '+token}
    }).then(r=>r.json());
    if (!search.members || !search.members.length) {
      showToast('❌ Member not found', true); return;
    }
    // Use first match
    var member = search.members[0];
    // Make them ambassador
    var res = await fetch(ATP_API + '/admin/members/' + member.id + '/ambassador', {
      method: 'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({enabled: true})
    }).then(r=>r.json());
    if (res.message || res.success) {
      showToast('✅ ' + member.first_name + ' is now an Ambassador!');
      document.getElementById('newAmbInput').value = '';
      document.getElementById('addAmbForm').style.display = 'none';
      setTimeout(function() {
        renderAmbassadors();
        loadMembersAPI && loadMembersAPI();
        loadCoachesSection && loadCoachesSection();
      }, 300);
    } else {
      showToast('❌ ' + (res.error || 'Failed'), true);
    }
  } catch(e) {
    showToast('❌ ' + e.message, true);
  }
}


function toggleAmbassador(id, enabled) {
  var m = MEMBERS_DATA.find(function(x){return x.id===id;});
  if (m) m.ambassadorActive = enabled;
  // In real app: API call to update user role
  showAdminToast((enabled?'✓ Ambassador activated':'Ambassador deactivated')+' for '+m.name);
  renderAmbassadors();
  
  // If this is the logged-in user, update localStorage
  var stored = null;
  try { stored = JSON.parse(localStorage.getItem('atp:user')); } catch(e){}
  if (stored && stored.email === m.email) {
    localStorage.setItem('atp:ambassador', enabled ? 'true' : 'false');
  }
}

function revokeAmbassador(id) {
  var m = MEMBERS_DATA.find(function(x){return x.id===id;});
  if (!m || !confirm('Revoke ambassador access for '+m.name+'?')) return;
  m.ambassador = false;
  m.ambassadorActive = false;
  showAdminToast('Ambassador access revoked for '+m.name, 'warn');
  renderAmbassadors();
}


// ── AMBASSADOR SCHEDULE + DAILY CHECK-IN (founder 2026-11-04) ──────────
// Who is on duty each day = ambassadors assigned to that day's sessions
// (session form → Assigned Ambassadors). The admin marks each one Present
// or Absent once per day; the overview grid shows the whole range.
// API: GET  /api/admin/ambassador-schedule?day=
//      GET  /api/admin/ambassador-schedule/overview?from=&to=
//      POST /api/admin/ambassador-schedule/attendance { ambassador_id, day, status, note }
// Every member-typed value goes through _escA before it touches HTML.
var _AMB_HUB = { from: '2026-10-31', to: '2026-11-29' };
var _ambSched = { day: null, data: null, busy: {} };
var _ambOv = { range: null, data: null };

function _escA(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _ambDubaiToday() { return new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); }
function _ambAddDays(day, n) {
  var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function _ambDayLabel(day) {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
}
function _ambTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { return ''; }
}
function _ambApi(method, path, body) {
  return fetch(ATP_API + path, {
    method: method,
    headers: Object.assign({ Authorization: 'Bearer ' + getToken() }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    });
  });
}

function ambSchedShift(n) { loadAmbSchedule(_ambAddDays(_ambSched.day || _ambDubaiToday(), n)); }

function loadAmbSchedule(day) {
  var host = document.getElementById('ambSchedBody');
  if (!host) return;
  _ambSched.day = day || _ambDubaiToday();
  _renderAmbSchedNav();
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading schedule…</div>';
  _ambApi('GET', '/admin/ambassador-schedule?day=' + encodeURIComponent(_ambSched.day))
    .then(function (d) { if (d.day === _ambSched.day) { _ambSched.data = d; _renderAmbSchedule(); } })
    .catch(function (e) {
      host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load the schedule: ' + _escA(e.message || e) + '</div>';
    });
}

function _renderAmbSchedNav() {
  var nav = document.getElementById('ambSchedNav');
  if (!nav) return;
  var isToday = _ambSched.day === _ambDubaiToday();
  nav.innerHTML =
    '<button class="admin-btn" onclick="ambSchedShift(-1)" aria-label="Previous day" style="padding:6px 12px">‹</button>' +
    '<input type="date" class="admin-form-input" value="' + _escA(_ambSched.day) + '" onchange="if(this.value)loadAmbSchedule(this.value)" aria-label="Day" style="width:auto;padding:6px 10px;font-size:12px">' +
    '<button class="admin-btn" onclick="ambSchedShift(1)" aria-label="Next day" style="padding:6px 12px">›</button>' +
    '<button class="admin-btn" onclick="loadAmbSchedule()" style="font-size:12px;padding:6px 12px;' +
      (isToday ? 'background:rgba(168,255,0,.12);color:#A8FF00;border:1px solid rgba(168,255,0,.35)' : '') + '">Today</button>';
}

function _ambStatusLine(a, editable) {
  if (a.attendance === 'present') {
    var at = _ambTime(a.checked_in_at);
    return '<span style="color:#A8FF00;font-weight:700">✓ Present</span>' +
      (at ? ' · arrived ' + at : ' · marked afterwards') +
      (a.marked_by_name ? ' · by ' + _escA(a.marked_by_name) : '');
  }
  if (a.attendance === 'absent') {
    return '<span style="color:#f87171;font-weight:700">✗ Absent</span>' +
      (a.note ? ' · ' + _escA(a.note) : '') +
      (a.marked_by_name ? ' · by ' + _escA(a.marked_by_name) : '');
  }
  return editable ? '<span style="color:#f59e0b">Not marked yet</span>' : '<span style="color:#666">Upcoming</span>';
}

function _ambRow(a, editable, scheduled) {
  var name = ((a.first_name || '') + ' ' + (a.last_name || '')).trim() || 'Member';
  var ini = (((a.first_name || '?')[0] || '?') + ((a.last_name || '?')[0] || '?')).toUpperCase();
  var busy = !!_ambSched.busy[a.id];
  var sessions = (a.sessions || []).map(function (s) {
    return '<span style="display:inline-block;background:#151515;border:1px solid #262626;border-radius:6px;padding:3px 8px;margin:4px 6px 0 0;font-size:11px;color:#ccc">' +
      '<strong style="color:#fff">' + _ambTime(s.scheduled_at) + '</strong> ' + _escA(s.name) +
      (s.location ? ' <span style="color:#666">· ' + _escA(s.location) + '</span>' : '') + '</span>';
  }).join('');
  var btn = function (status, label, on, color) {
    return '<button class="admin-btn" ' + (busy ? 'disabled ' : '') +
      'onclick="markAmbAttendance(\'' + a.id + '\',\'' + status + '\')" style="font-size:12px;padding:8px 14px;min-width:96px;' +
      (on ? 'background:' + color + '22;color:' + color + ';border:1px solid ' + color : '') + '">' + label + '</button>';
  };
  var actions = '';
  if (editable) {
    actions = btn('present', '✓ Present', a.attendance === 'present', '#A8FF00') +
      (scheduled || a.attendance === 'absent' ? btn('absent', '✗ Absent', a.attendance === 'absent', '#f87171') : '') +
      (a.attendance ? '<button class="admin-btn" ' + (busy ? 'disabled ' : '') + 'onclick="markAmbAttendance(\'' + a.id + '\',null)" style="font-size:11px;padding:6px 10px;color:#888">Undo</button>' : '');
  }
  return '<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.05)">' +
    '<div class="admin-av" style="background:rgba(255,196,0,.15);color:#ffc400;flex:none">' + _escA(ini) + '</div>' +
    '<div style="flex:1;min-width:220px">' +
      '<div class="admin-member-name">' + _escA(name) +
        (!scheduled && a.attendance ? ' <span style="font-size:10px;color:#888;border:1px solid #333;border-radius:4px;padding:1px 6px;margin-left:4px">Not on schedule</span>' : '') + '</div>' +
      '<div class="admin-member-email">' + _escA(a.member_number || '') +
        (a.phone ? ' · <a href="tel:' + _escA(a.phone) + '" style="color:#888">' + _escA(a.phone) + '</a>' : '') + '</div>' +
      (sessions ? '<div>' + sessions + '</div>' : '') +
      (scheduled || a.attendance ? '<div style="font-size:12px;color:#888;margin-top:6px">' + _ambStatusLine(a, editable) + '</div>' : '') +
    '</div>' +
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + actions + '</div>' +
  '</div>';
}

function _renderAmbSchedule() {
  var host = document.getElementById('ambSchedBody');
  var d = _ambSched.data;
  if (!host || !d) return;
  var list = d.ambassadors || [];
  var onDuty = list.filter(function (a) { return a.sessions.length || a.attendance; });
  var others = list.filter(function (a) { return !a.sessions.length && !a.attendance; });
  var c = d.counts || {};
  var chip = function (n, label, color) {
    return '<span style="display:inline-block;background:#111;border:1px solid #222;border-radius:8px;padding:6px 12px;margin:0 6px 6px 0;font-size:12px;color:#aaa">' +
      '<strong style="color:' + color + ';font-size:15px">' + (n || 0) + '</strong> ' + label + '</span>';
  };
  var html = '<div style="padding:14px 16px 8px">' +
    '<div style="font-family:var(--ff-display);font-size:15px;font-weight:800;color:#fff;margin-bottom:10px">' + _ambDayLabel(d.day) +
      (d.day === d.today ? ' <span style="color:#A8FF00;font-size:11px;letter-spacing:.1em">TODAY</span>' : '') + '</div>' +
    chip(c.scheduled, 'on the schedule', '#fff') +
    (d.editable ? chip(c.present, 'present', '#A8FF00') + chip(c.absent, 'absent', '#f87171') + chip(c.unmarked, 'not marked yet', '#f59e0b') : '') +
    (!d.editable ? '<div style="font-size:12px;color:#888;margin-top:4px">This day hasn\'t happened yet. You can mark attendance from the day itself.</div>' : '') +
  '</div>';
  html += onDuty.length
    ? onDuty.map(function (a) { return _ambRow(a, d.editable, a.sessions.length > 0); }).join('')
    : '<div style="padding:20px 16px;color:#666;font-size:13px">No ambassadors are assigned to sessions on this day. Assign them in the session form (👋 Assigned Ambassadors).</div>';
  if (others.length) {
    html += '<details style="border-top:1px solid rgba(255,255,255,.07)"' + (onDuty.length ? '' : ' open') + '>' +
      '<summary style="cursor:pointer;padding:12px 16px;font-size:12px;color:#888">Not on the schedule this day (' + others.length + ')' +
        (d.editable ? ' — mark anyone who turned up anyway' : '') + '</summary>' +
      others.map(function (a) { return _ambRow(a, d.editable, false); }).join('') +
    '</details>';
  }
  host.innerHTML = html;
}

function markAmbAttendance(id, status) {
  var d = _ambSched.data;
  if (!d) return;
  var a = (d.ambassadors || []).filter(function (x) { return x.id === id; })[0];
  if (!a || _ambSched.busy[id]) return;
  var note = null;
  if (status === 'absent') {
    note = prompt('Reason for the absence (optional):', a.note || '');
    if (note === null) return;
  }
  _ambSched.busy[id] = true;
  _renderAmbSchedule();
  var day = d.day;
  _ambApi('POST', '/admin/ambassador-schedule/attendance', { ambassador_id: id, day: day, status: status, note: note })
    .then(function () {
      delete _ambSched.busy[id];
      var name = (a.first_name || 'Ambassador');
      showToast(status === 'present' ? '✅ ' + name + ' checked in' : status === 'absent' ? name + ' marked absent' : 'Mark removed for ' + name);
      if (_ambSched.day === day) loadAmbSchedule(day);
      loadAmbOverview();
    })
    .catch(function (e) {
      delete _ambSched.busy[id];
      _renderAmbSchedule();
      showToast('❌ ' + (e.message || e), true);
    });
}

// ── Overview grid ──
function _ambRanges() {
  var today = _ambDubaiToday();
  var m0 = today.slice(0, 8) + '01';
  var lm = new Date(m0 + 'T00:00:00Z'); lm.setUTCMonth(lm.getUTCMonth() - 1);
  var lm0 = lm.toISOString().slice(0, 10);
  return [
    { key: 'hub', label: '30x30 Hub (31 Oct – 29 Nov)', from: _AMB_HUB.from, to: _AMB_HUB.to },
    { key: '14', label: 'Last 14 days', from: _ambAddDays(today, -13), to: today },
    { key: 'month', label: 'This month', from: m0, to: _ambAddDays(_ambAddDays(m0, 31).slice(0, 8) + '01', -1) },
    { key: 'last', label: 'Last month', from: lm0, to: _ambAddDays(m0, -1) }
  ];
}

function loadAmbOverview(key) {
  var host = document.getElementById('ambOvBody');
  if (!host) return;
  var ranges = _ambRanges();
  if (key) _ambOv.range = key;
  if (!_ambOv.range) _ambOv.range = _ambDubaiToday() <= _ambAddDays(_AMB_HUB.to, 14) ? 'hub' : '14';
  var r = ranges.filter(function (x) { return x.key === _ambOv.range; })[0] || ranges[0];
  var nav = document.getElementById('ambOvNav');
  if (nav) {
    nav.innerHTML = '<select class="admin-form-select" onchange="loadAmbOverview(this.value)" aria-label="Range" style="width:auto;padding:6px 10px;font-size:12px">' +
      ranges.map(function (x) { return '<option value="' + x.key + '"' + (x.key === r.key ? ' selected' : '') + '>' + x.label + '</option>'; }).join('') +
      '</select>' +
      '<button class="admin-btn" onclick="downloadAmbOverviewCsv()" style="font-size:12px;padding:6px 12px">⬇ CSV</button>';
  }
  if (!_ambOv.data) host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading overview…</div>';
  _ambApi('GET', '/admin/ambassador-schedule/overview?from=' + r.from + '&to=' + r.to)
    .then(function (d) { _ambOv.data = d; _renderAmbOverview(); })
    .catch(function (e) {
      host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load the overview: ' + _escA(e.message || e) + '</div>';
    });
}

// Per-cell state: P present, A absent, M scheduled + day passed + not marked,
// S scheduled (upcoming or today, not marked yet), '' nothing.
function _ambCellState(c, day, today) {
  if (!c) return '';
  if (c.status === 'present') return 'P';
  if (c.status === 'absent') return 'A';
  if (c.sessions) return day < today ? 'M' : 'S';
  return '';
}

function _ambActive(d) {
  return (d.ambassadors || []).filter(function (a) { return Object.keys(a.cells || {}).length; });
}

function _ambRate(a, today) {
  var due = 0, present = 0;
  Object.keys(a.cells || {}).forEach(function (day) {
    var c = a.cells[day];
    // today only counts once it's been marked — the day isn't over yet
    if (c.sessions && (day < today || (day === today && c.status))) { due++; if (c.status === 'present') present++; }
  });
  return due ? Math.round(100 * present / due) + '%' : '—';
}

function _renderAmbOverview() {
  var host = document.getElementById('ambOvBody');
  var d = _ambOv.data;
  if (!host || !d) return;
  var active = _ambActive(d);
  var idle = (d.ambassadors || []).length - active.length;
  if (!active.length) {
    host.innerHTML = '<div style="padding:20px 16px;color:#666;font-size:13px">Nobody is on the schedule in this range yet.</div>';
    return;
  }
  var STY = {
    P: 'background:rgba(168,255,0,.18);color:#A8FF00',
    A: 'background:rgba(248,113,113,.18);color:#f87171',
    M: 'background:rgba(245,158,11,.14);color:#f59e0b',
    S: 'color:#666'
  };
  var SYM = { P: '✓', A: '✗', M: '!', S: '○' };
  var TIP = { P: 'Present', A: 'Absent', M: 'On the schedule, not marked', S: 'On the schedule' };
  var th = 'padding:6px 4px;font-size:10px;font-weight:700;color:#888;text-align:center;border-bottom:1px solid #222;white-space:nowrap';
  var head = '<tr><th style="' + th + ';text-align:left;position:sticky;left:0;background:#0b0b0b;z-index:1;padding-left:16px">Ambassador</th>' +
    d.days.map(function (day) {
      var dt = new Date(day + 'T12:00:00Z');
      var wd = dt.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' }).slice(0, 2);
      return '<th style="' + th + (day === d.today ? ';color:#A8FF00' : '') + '">' + wd + '<br>' + dt.getUTCDate() + '</th>';
    }).join('') +
    '<th style="' + th + ';padding-left:10px">Present</th><th style="' + th + '">Absent</th><th style="' + th + '">On schedule</th><th style="' + th + ';padding-right:16px">Rate</th></tr>';
  var body = active.map(function (a) {
    var name = ((a.first_name || '') + ' ' + (a.last_name || '')).trim() || 'Member';
    return '<tr><td style="position:sticky;left:0;background:#0b0b0b;padding:6px 10px 6px 16px;font-size:12px;color:#fff;white-space:nowrap;border-bottom:1px solid #161616">' + _escA(name) + '</td>' +
      d.days.map(function (day) {
        var c = (a.cells || {})[day];
        var st = _ambCellState(c, day, d.today);
        var tip = st ? TIP[st] + (c && c.sessions ? ' · ' + c.sessions + ' session' + (c.sessions === 1 ? '' : 's') : '') + (c && c.note ? ' · ' + c.note : '') : '';
        return '<td onclick="ambOpenDay(\'' + day + '\')" title="' + _escA(day + (tip ? ' — ' + tip : '')) + '" style="cursor:pointer;text-align:center;padding:0;border-bottom:1px solid #161616;' +
          (day === d.today ? 'box-shadow:inset 1px 0 0 rgba(168,255,0,.25),inset -1px 0 0 rgba(168,255,0,.25);' : '') + '">' +
          '<div style="margin:3px 2px;border-radius:4px;height:22px;line-height:22px;font-size:12px;font-weight:800;min-width:22px;' + (STY[st] || '') + '">' + (SYM[st] || '') + '</div></td>';
      }).join('') +
      '<td style="text-align:center;color:#A8FF00;font-weight:700;font-size:12px;padding-left:10px;border-bottom:1px solid #161616">' + a.totals.present + '</td>' +
      '<td style="text-align:center;color:#f87171;font-weight:700;font-size:12px;border-bottom:1px solid #161616">' + a.totals.absent + '</td>' +
      '<td style="text-align:center;color:#ccc;font-size:12px;border-bottom:1px solid #161616">' + a.totals.scheduled_days + '</td>' +
      '<td style="text-align:center;color:#fff;font-weight:700;font-size:12px;padding-right:16px;border-bottom:1px solid #161616">' + _ambRate(a, d.today) + '</td></tr>';
  }).join('');
  var legend = Object.keys(SYM).map(function (k) {
    return '<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><span style="display:inline-block;width:20px;height:18px;line-height:18px;text-align:center;border-radius:4px;font-weight:800;font-size:11px;' + STY[k] + '">' + SYM[k] + '</span>' + TIP[k] + '</span>';
  }).join('');
  host.innerHTML =
    '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:max-content">' + head + body + '</table></div>' +
    '<div style="padding:12px 16px;font-size:11px;color:#888;line-height:2">' + legend +
      '<br>Rate = days present ÷ days on the schedule so far (today counts once marked). Click any day to open it above.' +
      (idle ? ' ' + idle + ' other ambassador' + (idle === 1 ? ' has' : 's have') + ' nothing on the schedule in this range.' : '') +
    '</div>';
}

function ambOpenDay(day) {
  loadAmbSchedule(day);
  var s = document.getElementById('ambScheduleSection');
  if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function downloadAmbOverviewCsv() {
  var d = _ambOv.data;
  if (!d) return;
  var LABEL = { P: 'Present', A: 'Absent', M: 'Not marked', S: 'Scheduled' };
  var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var lines = [['Ambassador', 'Member #'].concat(d.days, ['Present', 'Absent', 'Days on schedule', 'Rate']).map(q).join(',')];
  _ambActive(d).forEach(function (a) {
    var name = ((a.first_name || '') + ' ' + (a.last_name || '')).trim();
    lines.push([name, a.member_number || ''].concat(d.days.map(function (day) {
      return LABEL[_ambCellState((a.cells || {})[day], day, d.today)] || '';
    }), [a.totals.present, a.totals.absent, a.totals.scheduled_days, _ambRate(a, d.today)]).map(q).join(','));
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'ambassador-attendance_' + d.from + '_to_' + d.to + '.csv';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
}
