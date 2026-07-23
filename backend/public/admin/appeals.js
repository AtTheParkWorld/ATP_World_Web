/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Ban Appeals (R-MOD-005 / OQ-37)
 * Members file appeals from /appeal.html (POST /api/members/me/appeal).
 * Until now the queue had no UI — appeals landed in the DB and nobody
 * saw them. This module renders the pending queue + resolve actions:
 *   - GET   /api/admin/appeals              → pending appeals (member + ban info joined)
 *   - PATCH /api/admin/appeals/:id/resolve  → { status:'approved'|'denied', admin_notes?, unban? }
 * Approve = appeal approved AND member unbanned (unban:true).
 * Reject  = appeal denied, ban stays.
 * Sidebar badge mirrors the Partners "N new" pattern (adminPartnersBadge).
 * ════════════════════════════════════════════════════════════════ */

function loadAppealsSection() {
  var host = document.getElementById('appealsBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading appeals…</div>';
  fetch(ATP_API + '/admin/appeals', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, status: r.status, body: d || {} }; }); })
    .then(function(res){
      if (res.body.code === 'APPEALS_NOT_MIGRATED') {
        _updateAppealsBadge(0);
        host.innerHTML = '<div style="padding:24px;color:#fbbf24;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:10px;font-size:13px">⚠️ Appeals table not migrated yet. Run <code style="background:#0a0a0a;padding:2px 6px;border-radius:3px;color:#A8FF00">/api/auth/migrate-appeals</code> once, then reload this section.</div>';
        return;
      }
      if (!res.ok) throw new Error(res.body.error || ('HTTP ' + res.status));
      renderAppeals(res.body.appeals || []);
    })
    .catch(function(e){
      host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load appeals: ' + _esc(e.message || e) + '</div>';
    });
}

function renderAppeals(list) {
  var host = document.getElementById('appealsBody');
  if (!host) return;
  var pending = list.filter(function(a){ return a.status === 'pending'; });
  _updateAppealsBadge(pending.length);

  var html =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
      '<div style="font-size:13px;color:#888">' + pending.length + ' pending appeal' + (pending.length === 1 ? '' : 's') + '</div>' +
      '<button class="admin-btn" data-atp-call="loadAppealsSection" style="font-size:12px;padding:7px 14px">↻ Refresh</button>' +
    '</div>';

  if (!list.length) {
    html += '<div style="padding:40px;color:#555;text-align:center;font-size:13px;border:1px dashed #2a2a2a;border-radius:10px">No pending appeals. When a banned member pleads their case on <code style="background:#0a0a0a;padding:2px 6px;border-radius:3px;color:#A8FF00">/appeal</code>, it lands here.</div>';
    host.innerHTML = html;
    return;
  }

  html += '<table class="admin-table" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:#888;border-bottom:1px solid #1a1a1a">' +
    '<th style="padding:10px 12px">Member</th>' +
    '<th style="padding:10px 12px">Ban context</th>' +
    '<th style="padding:10px 12px">Appeal reason</th>' +
    '<th style="padding:10px 12px">Status</th>' +
    '<th style="padding:10px 12px">Filed</th>' +
    '<th style="padding:10px 12px;text-align:right">Actions</th>' +
    '</tr></thead><tbody>';

  list.forEach(function(a){
    var name = ((a.first_name || '') + ' ' + (a.last_name || '')).trim() || '(no name)';
    var filed = a.created_at ? new Date(a.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    var bannedAt = a.banned_at ? new Date(a.banned_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    var statusColors = {
      pending:  { fg: '#fbbf24', border: 'rgba(245,158,11,.4)', bg: 'rgba(245,158,11,.15)' },
      approved: { fg: '#A8FF00', border: 'rgba(168,255,0,.4)',  bg: 'rgba(168,255,0,.15)'  },
      denied:   { fg: '#fca5a5', border: 'rgba(239,68,68,.4)',  bg: 'rgba(239,68,68,.15)'  },
    };
    var c = statusColors[a.status] || statusColors.pending;

    // Reason excerpt — expandable via <details> when it runs long
    var reason = a.reason || '';
    var reasonHtml;
    if (reason.length > 140) {
      reasonHtml = '<details style="max-width:320px"><summary style="cursor:pointer;color:#ddd;list-style:none">' +
        _esc(reason.slice(0, 140)) + '… <span style="color:#A8FF00;font-size:11px">more</span></summary>' +
        '<div style="color:#aaa;margin-top:6px;white-space:pre-wrap;line-height:1.5">' + _esc(reason) + '</div></details>';
    } else {
      reasonHtml = '<div style="max-width:320px;color:#ddd;white-space:pre-wrap;line-height:1.5">' + _esc(reason) + '</div>';
    }

    html += '<tr style="border-bottom:1px solid #111;vertical-align:top">' +
      '<td style="padding:10px 12px;color:#fff">' + _esc(name) +
        '<br><span style="color:#666;font-size:11px">' + _esc(a.member_number || '') + ' · ' + _esc(a.email || '') + '</span></td>' +
      '<td style="padding:10px 12px;color:#aaa;font-size:11px;max-width:200px">' +
        (a.is_banned ? '<span style="color:#f87171;font-weight:700">Banned' + (bannedAt ? ' ' + bannedAt : '') + '</span>' : '<span style="color:#888">Not currently banned</span>') +
        (a.banned_reason ? '<br>' + _esc(a.banned_reason) : '') + '</td>' +
      '<td style="padding:10px 12px">' + reasonHtml + '</td>' +
      '<td style="padding:10px 12px"><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:' + c.fg + ';background:' + c.bg + ';border:1px solid ' + c.border + ';padding:3px 8px;border-radius:10px">' + _esc(a.status) + '</span></td>' +
      '<td style="padding:10px 12px;color:#aaa;white-space:nowrap">' + filed + '</td>' +
      '<td style="padding:10px 12px;text-align:right;white-space:nowrap">' +
        (a.status === 'pending'
          ? '<button class="admin-btn admin-btn-primary" data-atp-call="resolveAppeal" data-args=\'["' + a.id + '","approved"]\' style="font-size:11px;padding:5px 10px;margin-right:4px">✓ Approve · unban</button>' +
            '<button class="admin-btn" data-atp-call="resolveAppeal" data-args=\'["' + a.id + '","denied"]\' style="font-size:11px;padding:5px 10px;color:#f87171">✕ Reject</button>'
          : '<span style="color:#555;font-size:11px">resolved</span>') +
      '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  host.innerHTML = html;
}

// Resolve an appeal. decision: 'approved' (also unbans) | 'denied'.
// Called via data-atp-call, so args arrive positionally: (id, decision, btn).
function resolveAppeal(id, decision) {
  var approve = decision === 'approved';
  var msg = approve
    ? 'Approve this appeal?\n\nThe member will be UNBANNED and regains full access.'
    : 'Reject this appeal?\n\nThe member stays banned.';
  if (!confirm(msg)) return;
  var note = prompt('Optional note for the record (saved as admin_notes):') || '';
  fetch(ATP_API + '/admin/appeals/' + id + '/resolve', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({
      status: approve ? 'approved' : 'denied',
      admin_notes: note.trim() || null,
      unban: approve,
    }),
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.error) { showToast('❌ ' + d.error, true); return; }
      showToast(approve
        ? (d.unbanned ? '✅ Appeal approved — member unbanned' : '✅ Appeal approved')
        : '✅ Appeal rejected — ban stays');
      loadAppealsSection();
    })
    .catch(function(e){ showToast('❌ ' + (e.message || e), true); });
}

// ── Sidebar badge (pending count) ──────────────────────────────
function _updateAppealsBadge(count) {
  var badge = document.getElementById('adminAppealsBadge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count + ' pending'; badge.style.display = ''; }
  else badge.style.display = 'none';
}

// Quiet badge refresh — called from adminLogin (core.js) and on boot for
// the already-logged-in reload case (same pattern as init.js founder autoload).
function loadAppealsBadge() {
  if (typeof getToken !== 'function' || !getToken()) return;
  fetch(ATP_API + '/admin/appeals', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.ok ? r.json() : { appeals: [] }; })
    .then(function(d){
      var pending = ((d && d.appeals) || []).filter(function(a){ return a.status === 'pending'; });
      _updateAppealsBadge(pending.length);
    })
    .catch(function(){});
}
setTimeout(loadAppealsBadge, 400);
