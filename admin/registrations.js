/* ═══════════════════════════════════════════════════════════════
 * ATP Admin — Registrations & check-ins (founder 2026-10-27)
 *
 * "An easy way to track and extract the data from everyone who
 * registered for all our sessions (30x30 sessions and challenges
 * included), who was checked in, and the results for the challenges."
 *
 *   - filters: Dubai date range (+ quick ranges), category, session name
 *   - totals + one row per session (registered / checked in / rate);
 *     click a row for its attendee list (and a download of just that one)
 *   - downloads: all registrations or checked-in only, CSV or Excel
 *   - 30x30 challenge results: every attempt, or the qualifier / final
 *     leaderboard, CSV or Excel
 * Backed by GET /api/analytics/registrations and
 * /api/analytics/challenge-results/:id (admin only).
 * ═══════════════════════════════════════════════════════════════ */

var REG = { from: '', to: '', cat: '', q: '', open: null, chId: '' };

function _regEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function _regDubaiToday() { return new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10); }
function _regShift(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function _regDay(ymd) {
  var d = new Date(ymd + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function _regQS(extra) {
  var qs = '?from=' + encodeURIComponent(REG.from) + '&to=' + encodeURIComponent(REG.to);
  if (REG.cat) qs += '&category=' + encodeURIComponent(REG.cat);
  if (REG.q) qs += '&q=' + encodeURIComponent(REG.q);
  return qs + (extra || '');
}

function setRegRange(kind) {
  var t = _regDubaiToday();
  if (kind === 'hub30') { REG.from = '2026-10-31'; REG.to = '2026-11-29'; }
  else if (kind === 'past30') { REG.from = _regShift(t, -30); REG.to = t; }
  else if (kind === 'next30') { REG.from = t; REG.to = _regShift(t, 30); }
  else if (kind === 'today') { REG.from = t; REG.to = t; }
  else { REG.from = _regShift(t, -30); REG.to = _regShift(t, 30); }
  var f = document.getElementById('regFrom'), to = document.getElementById('regTo');
  if (f) f.value = REG.from; if (to) to.value = REG.to;
  loadRegistrations();
}

function loadRegistrationsSection() {
  var body = document.getElementById('regBody');
  if (!body) return;
  if (!REG.from) { var t = _regDubaiToday(); REG.from = _regShift(t, -30); REG.to = _regShift(t, 30); }
  var btn = 'class="admin-btn" style="font-size:12px;padding:8px 12px"';
  body.innerHTML =
    '<div style="background:#111;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:16px;margin-bottom:16px">' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">' +
        '<div><label class="admin-form-label" for="regFrom">From</label><input class="admin-form-input" type="date" id="regFrom" value="' + REG.from + '" style="width:150px"></div>' +
        '<div><label class="admin-form-label" for="regTo">To</label><input class="admin-form-input" type="date" id="regTo" value="' + REG.to + '" style="width:150px"></div>' +
        '<div><label class="admin-form-label" for="regCat">Category</label><select class="admin-form-input" id="regCat" style="width:170px">' +
          [['', 'All sessions'], ['regular', '🏃 Regular'], ['social', '🎉 Social'], ['team_sports', '🏆 Team sports'], ['30x30_hub', '🔥 30x30 Hub'], ['30x30_challenge', '🏁 30x30 Challenge']]
            .map(function (o) { return '<option value="' + o[0] + '"' + (REG.cat === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select></div>' +
        '<div style="flex:1;min-width:180px"><label class="admin-form-label" for="regQ">Session name</label><input class="admin-form-input" id="regQ" placeholder="e.g. Reebok, Yoga…" value="' + _regEsc(REG.q) + '"></div>' +
        '<button type="button" ' + btn.replace('admin-btn', 'admin-btn admin-btn-primary') + ' onclick="applyRegFilters()">Apply</button>' +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' +
        '<button type="button" ' + btn + ' onclick="setRegRange(\'hub30\')">🔥 30x30 Hub (31 Oct – 29 Nov)</button>' +
        '<button type="button" ' + btn + ' onclick="setRegRange(\'today\')">Today</button>' +
        '<button type="button" ' + btn + ' onclick="setRegRange(\'past30\')">Last 30 days</button>' +
        '<button type="button" ' + btn + ' onclick="setRegRange(\'next30\')">Next 30 days</button>' +
      '</div>' +
    '</div>' +
    '<div id="regKpis" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px"></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">' +
      '<span style="font-size:12px;color:#888;margin-right:4px">Download (these filters):</span>' +
      '<button type="button" ' + btn + ' onclick="exportRegistrations(false,\'csv\')">⬇ All registrations · CSV</button>' +
      '<button type="button" ' + btn + ' onclick="exportRegistrations(false,\'xlsx\')">⬇ All registrations · Excel</button>' +
      '<button type="button" ' + btn + ' onclick="exportRegistrations(true,\'csv\')">⬇ Checked-in only · CSV</button>' +
      '<button type="button" ' + btn + ' onclick="exportRegistrations(true,\'xlsx\')">⬇ Checked-in only · Excel</button>' +
    '</div>' +
    '<div id="regTable"></div>' +
    '<div style="margin-top:26px;background:#111;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:16px">' +
      '<div style="font-family:var(--ff-display,inherit);font-weight:800;font-size:16px;color:#fff;margin-bottom:4px">🏁 30x30 Challenge results</div>' +
      '<div style="font-size:12px;color:#888;margin-bottom:12px">Every recorded attempt, or the leaderboard (best result per athlete / team, with the finals cut).</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<select class="admin-form-input" id="regCh" style="width:240px" onchange="REG.chId=this.value"><option value="">Loading challenges…</option></select>' +
        '<button type="button" ' + btn + ' onclick="exportChallengeResults(\'attempts\',\'\',\'csv\')">⬇ All results · CSV</button>' +
        '<button type="button" ' + btn + ' onclick="exportChallengeResults(\'attempts\',\'\',\'xlsx\')">⬇ All results · Excel</button>' +
        '<button type="button" ' + btn + ' onclick="exportChallengeResults(\'leaderboard\',\'qualifier\',\'xlsx\')">⬇ Qualifier leaderboard · Excel</button>' +
        '<button type="button" ' + btn + ' onclick="exportChallengeResults(\'leaderboard\',\'final\',\'xlsx\')">⬇ Final leaderboard · Excel</button>' +
      '</div>' +
    '</div>';
  document.getElementById('regQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyRegFilters(); });
  loadRegistrations();
  apiGet('/hub-challenges/admin').then(function (d) {
    var sel = document.getElementById('regCh'); if (!sel) return;
    var list = (d && d.challenges) || [];
    sel.innerHTML = list.length
      ? list.map(function (c, i) { return '<option value="' + c.id + '"' + (i === 0 ? ' selected' : '') + '>' + _regEsc(c.name) + (c.kind === 'team' ? ' (team)' : '') + '</option>'; }).join('')
      : '<option value="">No challenges yet</option>';
    REG.chId = list.length ? list[0].id : '';
  }).catch(function () {
    var sel = document.getElementById('regCh'); if (sel) sel.innerHTML = '<option value="">Couldn’t load challenges</option>';
  });
}

function applyRegFilters() {
  REG.from = (document.getElementById('regFrom') || {}).value || REG.from;
  REG.to = (document.getElementById('regTo') || {}).value || REG.to;
  if (REG.to < REG.from) { var x = REG.from; REG.from = REG.to; REG.to = x; }
  REG.cat = (document.getElementById('regCat') || {}).value || '';
  REG.q = ((document.getElementById('regQ') || {}).value || '').trim();
  loadRegistrations();
}

async function loadRegistrations() {
  var tbl = document.getElementById('regTable'), kp = document.getElementById('regKpis');
  if (!tbl) return;
  REG.open = null;
  tbl.innerHTML = '<div style="padding:30px;text-align:center;color:#666">Loading…</div>';
  try {
    var d = await apiGet('/analytics/registrations' + _regQS(''));
    if (!d || d.error) throw new Error((d && d.error) || 'Could not load registrations');
    var t = d.totals || {};
    var rate = t.registered ? Math.round(100 * t.checked_in / t.registered) : 0;
    var kpi = function (v, l, c) { return '<div style="background:#111;border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px"><div style="font-size:24px;font-weight:900;color:' + (c || '#A8FF00') + '">' + v + '</div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-top:2px">' + l + '</div></div>'; };
    if (kp) kp.innerHTML = kpi(t.sessions || 0, 'Sessions', '#fff') + kpi(t.registered || 0, 'Registrations') + kpi(t.checked_in || 0, 'Checked in') + kpi(rate + '%', 'Check-in rate', '#f5c042');
    var rows = d.sessions || [];
    if (!rows.length) { tbl.innerHTML = '<div style="padding:30px;text-align:center;color:#666">No sessions in this range.</div>'; return; }
    tbl.innerHTML = '<div style="overflow:auto;border:1px solid rgba(255,255,255,.07);border-radius:10px"><table class="admin-table" style="width:100%">' +
      '<thead><tr><th>Date</th><th>Time</th><th>Session</th><th>Category</th><th style="text-align:right">Registered</th><th style="text-align:right">Checked in</th><th style="text-align:right">Rate</th><th></th></tr></thead><tbody>' +
      rows.map(function (s) {
        var r = s.registered ? Math.round(100 * s.checked_in / s.registered) + '%' : '—';
        return '<tr class="reg-row" data-sid="' + s.session_id + '" style="cursor:pointer" onclick="toggleRegSession(\'' + s.session_id + '\')">' +
          '<td style="white-space:nowrap">' + _regDay(s.date) + '</td><td>' + s.time + '</td>' +
          '<td><div class="admin-member-name">' + _regEsc(s.name) + '</div><div class="admin-member-email">' + _regEsc(s.location || '') + '</div></td>' +
          '<td style="font-size:12px;color:#888">' + _regEsc(s.category) + '</td>' +
          '<td style="text-align:right;font-weight:700">' + s.registered + (s.capacity ? '<span style="color:#555;font-weight:400"> / ' + s.capacity + '</span>' : '') + (s.waitlisted ? '<div style="font-size:10px;color:#f5c042">+' + s.waitlisted + ' waitlist</div>' : '') + '</td>' +
          '<td style="text-align:right;font-weight:700;color:#A8FF00">' + s.checked_in + '</td>' +
          '<td style="text-align:right">' + r + '</td>' +
          '<td style="color:#666;font-size:12px" id="regChev-' + s.session_id + '">▾</td></tr>' +
          '<tr id="regDetail-' + s.session_id + '" style="display:none"><td colspan="8" style="background:#0c0c0c;padding:0"></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (rows.length >= 2000 ? '<div style="font-size:12px;color:#f5c042;margin-top:8px">Showing the first 2,000 sessions — narrow the dates to see the rest.</div>' : '');
  } catch (e) {
    tbl.innerHTML = '<div style="padding:30px;text-align:center;color:#ef4444">' + _regEsc(e.message) + '</div>';
    if (kp) kp.innerHTML = '';
  }
}

async function toggleRegSession(sid) {
  var row = document.getElementById('regDetail-' + sid), chev = document.getElementById('regChev-' + sid);
  if (!row) return;
  if (row.style.display !== 'none') { row.style.display = 'none'; if (chev) chev.textContent = '▾'; return; }
  row.style.display = ''; if (chev) chev.textContent = '▴';
  var cell = row.firstElementChild;
  cell.innerHTML = '<div style="padding:16px;color:#666">Loading attendees…</div>';
  try {
    var d = await apiGet('/analytics/registrations' + _regQS('&session_id=' + sid));
    var list = (d && d.attendees) || [];
    var btn = 'class="admin-btn" style="font-size:11px;padding:6px 10px"';
    cell.innerHTML = '<div style="padding:12px 14px">' +
      '<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center"><span style="font-size:12px;color:#888;flex:1">' + list.length + ' registered · ' + list.filter(function (a) { return a.checked_in === 'Yes'; }).length + ' checked in</span>' +
        '<button type="button" ' + btn + ' onclick="event.stopPropagation();exportRegistrations(false,\'xlsx\',\'' + sid + '\')">⬇ This session · Excel</button>' +
        '<button type="button" ' + btn + ' onclick="event.stopPropagation();exportRegistrations(false,\'csv\',\'' + sid + '\')">⬇ CSV</button></div>' +
      (list.length ? '<table class="admin-table" style="width:100%"><thead><tr><th>Member</th><th>Email</th><th>Phone</th><th>Status</th><th>Checked in</th></tr></thead><tbody>' +
        list.map(function (a) {
          var ci = a.checked_in === 'Yes' ? '<span style="color:#A8FF00;font-weight:700">✓ ' + _regEsc((a.checked_in_at || '').slice(11)) + '</span>'
                 : a.checked_in === 'Pending approval' ? '<span style="color:#f5c042">Pending approval</span>' : '<span style="color:#555">—</span>';
          return '<tr><td><div class="admin-member-name">' + _regEsc(a.first_name + ' ' + (a.last_name || '')) + '</div><div class="admin-member-email">' + _regEsc(a.member_number || '') + '</div></td>' +
            '<td style="font-size:12px">' + _regEsc(a.email || '') + '</td><td style="font-size:12px">' + _regEsc(a.phone || '') + '</td>' +
            '<td style="font-size:12px;color:#888">' + _regEsc(a.booking_status) + '</td><td>' + ci + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div style="color:#666;font-size:13px">Nobody registered yet.</div>') +
      '</div>';
  } catch (e) {
    cell.innerHTML = '<div style="padding:16px;color:#ef4444">' + _regEsc(e.message) + '</div>';
  }
}

function exportRegistrations(checkedInOnly, format, sessionId) {
  var ext = format === 'xlsx' ? 'xls' : 'csv';
  var name = (checkedInOnly ? 'atp-checked-in' : 'atp-registrations') + (REG.cat ? '-' + REG.cat.replace(/_/g, '-') : '') +
             (sessionId ? '-session' : '') + '-' + REG.from + '-to-' + REG.to + '.' + ext;
  var extra = '&format=' + format + (checkedInOnly ? '&checked_in=1' : '') + (sessionId ? '&session_id=' + sessionId : '');
  _downloadAuthed(ATP_API + '/analytics/registrations' + _regQS(extra), name);
}

function exportChallengeResults(type, stage, format) {
  var sel = document.getElementById('regCh');
  var id = (sel && sel.value) || REG.chId;
  if (!id) { showToast('Pick a challenge first', true); return; }
  var label = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text.replace(/\s*\(team\)$/, '') : 'challenge';
  var slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  var ext = format === 'xlsx' ? 'xls' : 'csv';
  var name = slug + (type === 'leaderboard' ? '-' + stage + '-leaderboard' : '-all-results') + '.' + ext;
  _downloadAuthed(ATP_API + '/analytics/challenge-results/' + encodeURIComponent(id) + '?type=' + type + (stage ? '&stage=' + stage : '') + '&format=' + format, name);
}

window.loadRegistrationsSection = loadRegistrationsSection;
window.setRegRange = setRegRange;
window.applyRegFilters = applyRegFilters;
window.toggleRegSession = toggleRegSession;
window.exportRegistrations = exportRegistrations;
window.exportChallengeResults = exportChallengeResults;
