/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Check-in approvals
 * Founder 2026-10-16: a second level of approval for MANUAL check-ins.
 * When an ambassador or coach checks a member in by picking them from the
 * list (no QR scan, no booking code), the check-in waits here as pending.
 * Approve → it counts (attendance, streak, badges, points) at the original
 * time. Reject → it doesn't count. QR / code check-ins and admins' own
 * manual check-ins never come here.
 *
 * API: GET  /api/sessions/admin/checkin-approvals?status=…
 *      POST /api/sessions/admin/checkin-approvals/approve { booking_ids }
 *      POST /api/sessions/admin/checkin-approvals/reject  { booking_ids, note }
 * Every member-typed value goes through _escC before it touches HTML.
 * ════════════════════════════════════════════════════════════════ */

var _ciState = { status: 'pending', rows: [], selected: {} };

function _escC(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _ciWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(iso); }
}

// Sidebar badge with the number waiting — refreshed on load and after actions.
function updateCheckinApprovalsBadge(n) {
  var b = document.getElementById('ciNavBadge');
  if (!b) return;
  if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.style.display = 'inline-block'; }
  else b.style.display = 'none';
}
function refreshCheckinApprovalsBadge() {
  if (typeof getToken !== 'function' || !getToken()) return;
  fetch(ATP_API + '/sessions/admin/checkin-approvals?status=pending&limit=1', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.counts) updateCheckinApprovalsBadge(d.counts.pending || 0); })
    .catch(function () {});
}

function checkinApprovalsFilter(status) {
  _ciState.status = status;
  _ciState.selected = {};
  loadCheckinApprovalsSection();
}

function loadCheckinApprovalsSection() {
  var host = document.getElementById('checkinApprovalsBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading check-ins…</div>';
  fetch(ATP_API + '/sessions/admin/checkin-approvals?status=' + encodeURIComponent(_ciState.status) + '&limit=300', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
    .then(function (d) {
      _ciState.rows = d.approvals || [];
      updateCheckinApprovalsBadge((d.counts && d.counts.pending) || 0);
      _renderCheckinApprovals(d.counts || {});
    })
    .catch(function (e) {
      host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load check-ins: ' + _escC(e.message || e) + '</div>';
    });
}

function _renderCheckinApprovals(counts) {
  var host = document.getElementById('checkinApprovalsBody');
  var tabs = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];
  var html = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">' +
    tabs.map(function (t) {
      var on = _ciState.status === t[0];
      var n = t[0] === 'all' ? '' : ' (' + (counts[t[0]] || 0) + ')';
      return '<button class="admin-btn" onclick="checkinApprovalsFilter(\'' + t[0] + '\')" style="font-size:12px;padding:6px 14px;' +
        (on ? 'background:rgba(168,255,0,.12);color:#A8FF00;border:1px solid rgba(168,255,0,.35)' : '') + '">' + t[1] + n + '</button>';
    }).join('') +
    '<span style="flex:1"></span>' +
    (_ciState.status === 'pending' && _ciState.rows.length
      ? '<button class="admin-btn" id="ciApproveSel" onclick="approveSelectedCheckins()" style="font-size:12px;padding:6px 14px;background:rgba(168,255,0,.12);color:#A8FF00;border:1px solid rgba(168,255,0,.35)" disabled>✓ Approve selected</button>' +
        '<button class="admin-btn" id="ciRejectSel" onclick="rejectSelectedCheckins()" style="font-size:12px;padding:6px 14px;color:#f87171;border:1px solid rgba(248,113,113,.35)" disabled>✕ Reject selected</button>'
      : '') +
    '</div>';

  if (!_ciState.rows.length) {
    html += '<div style="padding:50px 20px;text-align:center;color:#666;border:1px dashed #222;border-radius:12px">' +
      (_ciState.status === 'pending' ? '✓ Nothing waiting — every manual check-in has been reviewed.' : 'No check-ins here yet.') + '</div>';
    host.innerHTML = html;
    return;
  }

  var pending = _ciState.status === 'pending';
  html += '<div style="overflow-x:auto"><table class="admin-table" style="width:100%;border-collapse:collapse;font-size:12px;min-width:860px"><thead><tr style="text-align:left;color:#888;border-bottom:1px solid #1a1a1a">' +
    (pending ? '<th style="padding:10px 8px;width:28px"><input type="checkbox" id="ciAll" onchange="toggleAllCheckins(this.checked)" aria-label="Select all"></th>' : '') +
    '<th style="padding:10px 8px">Member</th><th style="padding:10px 8px">Session</th><th style="padding:10px 8px">Checked in by</th>' +
    '<th style="padding:10px 8px">Requested</th><th style="padding:10px 8px">Status</th><th style="padding:10px 8px;text-align:right">' + (pending ? 'Action' : '') + '</th></tr></thead><tbody>';

  _ciState.rows.forEach(function (r) {
    var who = _escC(((r.first_name || '') + ' ' + (r.last_name || '')).trim() || 'Member');
    var by = _escC(((r.requested_by_first || '') + ' ' + (r.requested_by_last || '')).trim() || '—');
    var rev = r.reviewed_by_first ? ' by ' + _escC(r.reviewed_by_first + ' ' + (r.reviewed_by_last || '')) : '';
    var st = r.review === 'pending'
      ? '<span style="color:#f5c042;font-weight:700">⏳ Pending</span>'
      : r.review === 'approved'
        ? '<span style="color:#A8FF00;font-weight:700">✓ Approved</span><div style="color:#666;font-size:11px">' + _ciWhen(r.reviewed_at) + rev + '</div>'
        : '<span style="color:#f87171;font-weight:700">✕ Rejected</span><div style="color:#666;font-size:11px">' + _ciWhen(r.reviewed_at) + rev + (r.note ? ' · ' + _escC(r.note) : '') + '</div>';
    html += '<tr style="border-bottom:1px solid #141414">' +
      (pending ? '<td style="padding:10px 8px"><input type="checkbox" data-ci="' + _escC(r.booking_id) + '" onchange="toggleCheckin(this)" aria-label="Select ' + who + '"></td>' : '') +
      '<td style="padding:10px 8px"><div style="color:#fff;font-weight:700">' + who + '</div><div style="color:#666;font-size:11px">' + _escC(r.member_number || '') + '</div></td>' +
      '<td style="padding:10px 8px"><div style="color:#ddd">' + _escC(r.session_name || '') + '</div><div style="color:#666;font-size:11px">' + _ciWhen(r.scheduled_at) +
        (r.location ? ' · ' + _escC(r.location) : '') + (r.city_name ? ', ' + _escC(r.city_name) : '') + '</div></td>' +
      '<td style="padding:10px 8px;color:#ddd">' + by + '</td>' +
      '<td style="padding:10px 8px;color:#aaa">' + _ciWhen(r.requested_at) + '</td>' +
      '<td style="padding:10px 8px">' + st + '</td>' +
      '<td style="padding:10px 8px;text-align:right;white-space:nowrap">' + (r.review === 'pending'
        ? '<button class="admin-btn" onclick="approveCheckins([\'' + _escC(r.booking_id) + '\'])" style="font-size:11px;padding:5px 12px;background:rgba(168,255,0,.12);color:#A8FF00;border:1px solid rgba(168,255,0,.35)">✓ Approve</button> ' +
          '<button class="admin-btn" onclick="rejectCheckins([\'' + _escC(r.booking_id) + '\'])" style="font-size:11px;padding:5px 12px;color:#f87171;border:1px solid rgba(248,113,113,.35)">✕ Reject</button>'
        : '') + '</td></tr>';
  });
  html += '</tbody></table></div>';
  host.innerHTML = html;
}

function _ciSelectedIds() { return Object.keys(_ciState.selected).filter(function (k) { return _ciState.selected[k]; }); }
function _ciSyncBulk() {
  var n = _ciSelectedIds().length;
  ['ciApproveSel', 'ciRejectSel'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = n === 0; });
  var a = document.getElementById('ciApproveSel'); if (a) a.textContent = '✓ Approve selected' + (n ? ' (' + n + ')' : '');
}
function toggleCheckin(el) { _ciState.selected[el.getAttribute('data-ci')] = el.checked; _ciSyncBulk(); }
function toggleAllCheckins(on) {
  document.querySelectorAll('#checkinApprovalsBody input[data-ci]').forEach(function (el) { el.checked = on; _ciState.selected[el.getAttribute('data-ci')] = on; });
  _ciSyncBulk();
}

function _ciPost(path, body) {
  return fetch(ATP_API + '/sessions/admin/checkin-approvals/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() }, body: JSON.stringify(body),
  }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
}
function _ciToast(msg, ok) {
  if (typeof showToast === 'function') { showToast(msg, !ok); return; }
  alert(msg);
}

function approveCheckins(ids) {
  if (!ids || !ids.length) return;
  _ciPost('approve', { booking_ids: ids })
    .then(function (d) {
      var msg = d.approved + ' check-in' + (d.approved === 1 ? '' : 's') + ' approved';
      if (d.skipped && d.skipped.length) msg += ' · ' + d.skipped.length + ' already settled';
      _ciToast(msg, true);
      _ciState.selected = {};
      loadCheckinApprovalsSection();
    })
    .catch(function (e) { _ciToast('Approve failed: ' + (e.message || e), false); });
}
function rejectCheckins(ids) {
  if (!ids || !ids.length) return;
  var note = window.prompt('Reject ' + ids.length + ' check-in' + (ids.length === 1 ? '' : 's') + '? Optional reason (shown to admins only):', '');
  if (note === null) return;   // cancelled
  _ciPost('reject', { booking_ids: ids, note: note })
    .then(function (d) {
      _ciToast(d.rejected + ' check-in' + (d.rejected === 1 ? '' : 's') + ' rejected', true);
      _ciState.selected = {};
      loadCheckinApprovalsSection();
    })
    .catch(function (e) { _ciToast('Reject failed: ' + (e.message || e), false); });
}
function approveSelectedCheckins() { approveCheckins(_ciSelectedIds()); }
function rejectSelectedCheckins() { rejectCheckins(_ciSelectedIds()); }

// Badge as soon as the admin page opens.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshCheckinApprovalsBadge);
else refreshCheckinApprovalsBadge();
