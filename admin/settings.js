/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Settings (Theme 5b)
 * Three sub-tabs in one section: Announcements, Activities, System Config.
 * Each one is a thin CRUD wrapping the corresponding /api/* endpoints.
 * Loaded via showAdminSection('settings') hook in init.js.
 * ════════════════════════════════════════════════════════════════ */

// ── Sub-tab switcher ─────────────────────────────────────────
function showSettingsTab(tab) {
  ['announcements','activities','config'].forEach(function(t){
    var pane = document.getElementById('settings-pane-' + t);
    if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
  });
  document.querySelectorAll('.settings-tab').forEach(function(b){
    var match = (b.getAttribute('data-args') || '').indexOf('"' + tab + '"') >= 0;
    b.style.borderBottomColor = match ? '#7AC231' : 'transparent';
    b.style.color = match ? '#fff' : '#888';
  });
  if (tab === 'announcements') loadAnnouncementsAdmin();
  else if (tab === 'activities') loadActivitiesAdmin();
  else if (tab === 'config') loadSystemConfig();
}

function loadSettingsSection() {
  // Default to announcements + lazy-load all three so re-tabbing is instant
  showSettingsTab('announcements');
}

// ════════════════════════════════════════════════════════════
// ANNOUNCEMENTS (#34, #35)
// ════════════════════════════════════════════════════════════

function loadAnnouncementsAdmin() {
  fetch(ATP_API + '/announcements/admin', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){ renderAnnouncementsAdmin((data && data.announcements) || []); })
    .catch(function(){ document.getElementById('announcementsList').innerHTML =
      '<div style="padding:14px;color:#f87171">Failed to load announcements.</div>'; });
}

function renderAnnouncementsAdmin(list) {
  var el = document.getElementById('announcementsList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No announcements yet. Create one above.</div>';
    return;
  }
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse">' +
      '<thead><tr style="font-size:11px;color:#666;text-align:left;border-bottom:1px solid #1a1a1a">' +
        '<th style="padding:10px">Status</th><th style="padding:10px">Kind</th><th style="padding:10px">Message</th>' +
        '<th style="padding:10px;text-align:right">Priority</th><th style="padding:10px">Window</th><th style="padding:10px"></th>' +
      '</tr></thead><tbody>' +
      list.map(function(a){
        var msg = (a.message || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var statusBadge = a.is_active
          ? '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(122,194,49,.15);color:#7AC231">Active</span>'
          : '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.06);color:#666">Off</span>';
        var window_ = (a.starts_at || a.ends_at)
          ? (a.starts_at ? new Date(a.starts_at).toLocaleDateString('en-GB') : '∞') +
            ' → ' +
            (a.ends_at ? new Date(a.ends_at).toLocaleDateString('en-GB') : '∞')
          : 'Always';
        return '<tr style="border-bottom:1px solid #111;font-size:13px">' +
          '<td style="padding:10px">' + statusBadge + '</td>' +
          '<td style="padding:10px;color:#aaa;font-size:11px">' + (a.kind || 'info') + '</td>' +
          '<td style="padding:10px;color:#fff">' + msg + (a.link_url ? ' <span style="color:#666;font-size:10px">↗</span>' : '') + '</td>' +
          '<td style="padding:10px;text-align:right;color:#aaa">' + (a.priority || 0) + '</td>' +
          '<td style="padding:10px;color:#888;font-size:11px">' + window_ + '</td>' +
          '<td style="padding:10px;text-align:right">' +
            '<button class="admin-btn" style="font-size:11px;padding:5px 10px;margin-right:4px" data-atp-call="editAnnouncement" data-args=\'["' + a.id + '"]\'>Edit</button>' +
            '<button class="admin-btn admin-btn-danger" style="font-size:11px;padding:5px 10px" data-atp-call="deleteAnnouncement" data-args=\'["' + a.id + '"]\'>Delete</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
    '</tbody></table>';
}

function showAnnouncementForm() {
  document.getElementById('announcementFormWrap').style.display = 'block';
  document.getElementById('announcementFormTitle').textContent = 'New announcement';
  ['anEditId','anMessage','anLink','anPriority','anStarts','anEnds'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = id === 'anPriority' ? '0' : '';
  });
  document.getElementById('anKind').value = 'info';
  document.getElementById('anActive').checked = true;
  document.getElementById('anMessage').focus();
}
function cancelAnnouncementForm() {
  document.getElementById('announcementFormWrap').style.display = 'none';
}
function editAnnouncement(e, btn) {
  // data-args carries the id; the delegator already passed it
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  fetch(ATP_API + '/announcements/admin', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var a = ((data && data.announcements) || []).find(function(x){ return x.id === id; });
      if (!a) { showToast('Announcement not found', true); return; }
      document.getElementById('announcementFormWrap').style.display = 'block';
      document.getElementById('announcementFormTitle').textContent = 'Edit announcement';
      document.getElementById('anEditId').value = id;
      document.getElementById('anMessage').value = a.message || '';
      document.getElementById('anKind').value    = a.kind || 'info';
      document.getElementById('anPriority').value = a.priority || 0;
      document.getElementById('anLink').value    = a.link_url || '';
      document.getElementById('anStarts').value  = a.starts_at ? new Date(a.starts_at).toISOString().slice(0,16) : '';
      document.getElementById('anEnds').value    = a.ends_at   ? new Date(a.ends_at).toISOString().slice(0,16)   : '';
      document.getElementById('anActive').checked = !!a.is_active;
    });
}

function saveAnnouncement() {
  var id = document.getElementById('anEditId').value;
  var body = {
    message:   document.getElementById('anMessage').value.trim(),
    kind:      document.getElementById('anKind').value,
    priority:  Number(document.getElementById('anPriority').value) || 0,
    link_url:  document.getElementById('anLink').value.trim() || null,
    starts_at: document.getElementById('anStarts').value || null,
    ends_at:   document.getElementById('anEnds').value || null,
    is_active: document.getElementById('anActive').checked,
  };
  if (!body.message) { showToast('Message required', true); return; }
  var url    = id ? (ATP_API + '/announcements/admin/' + id) : (ATP_API + '/announcements/admin');
  var method = id ? 'PATCH' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast(id ? '✅ Announcement updated' : '✅ Announcement created');
      cancelAnnouncementForm();
      loadAnnouncementsAdmin();
      // Re-pull the public ticker so it reflects the change immediately
      if (window.ATPComponents && window.ATPComponents.loadTicker) ATPComponents.loadTicker();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

function deleteAnnouncement(e, btn) {
  if (!confirm('Delete this announcement?')) return;
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  fetch(ATP_API + '/announcements/admin/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(){
      showToast('✅ Announcement deleted');
      loadAnnouncementsAdmin();
      if (window.ATPComponents && window.ATPComponents.loadTicker) ATPComponents.loadTicker();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

// ════════════════════════════════════════════════════════════
// ACTIVITIES (#9 admin)
// ════════════════════════════════════════════════════════════

function loadActivitiesAdmin() {
  fetch(ATP_API + '/activities/admin', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){ renderActivitiesAdmin((data && data.activities) || []); })
    .catch(function(){ document.getElementById('activitiesList').innerHTML =
      '<div style="padding:14px;color:#f87171">Failed to load activities.</div>'; });
}

function renderActivitiesAdmin(list) {
  var el = document.getElementById('activitiesList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No activities yet.</div>';
    return;
  }
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">' +
      list.map(function(a){
        var name = (a.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var icon = a.icon || '🏷️';
        var border = a.is_active ? 'rgba(122,194,49,.3)' : 'rgba(255,255,255,.08)';
        var op = a.is_active ? '1' : '.45';
        return '<div style="background:#0d0d0d;border:1px solid ' + border + ';border-radius:10px;padding:14px;opacity:' + op + '">' +
          '<div style="font-size:24px;margin-bottom:8px">' + icon + '</div>' +
          '<div style="font-size:14px;font-weight:700;margin-bottom:2px">' + name + '</div>' +
          '<div style="font-size:11px;color:#666;margin-bottom:10px">Order ' + (a.sort_order || 100) + ' · ' + (a.is_active ? 'Active' : 'Off') + '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="admin-btn" style="font-size:11px;padding:5px 10px;flex:1" data-atp-call="editActivity" data-args=\'["' + a.id + '"]\'>Edit</button>' +
            '<button class="admin-btn admin-btn-danger" style="font-size:11px;padding:5px 10px" data-atp-call="deleteActivity" data-args=\'["' + a.id + '"]\'>×</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
}

function showActivityForm() {
  document.getElementById('activityFormWrap').style.display = 'block';
  document.getElementById('activityFormTitle').textContent = 'New activity';
  ['actEditId','actName','actIcon'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('actSort').value = '100';
  document.getElementById('actName').focus();
}
function cancelActivityForm() {
  document.getElementById('activityFormWrap').style.display = 'none';
}
function editActivity(e, btn) {
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  fetch(ATP_API + '/activities/admin', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var a = ((data && data.activities) || []).find(function(x){ return x.id === id; });
      if (!a) { showToast('Activity not found', true); return; }
      document.getElementById('activityFormWrap').style.display = 'block';
      document.getElementById('activityFormTitle').textContent = 'Edit activity';
      document.getElementById('actEditId').value = id;
      document.getElementById('actName').value   = a.name || '';
      document.getElementById('actIcon').value   = a.icon || '';
      document.getElementById('actSort').value   = a.sort_order || 100;
    });
}
function saveActivity() {
  var id = document.getElementById('actEditId').value;
  var body = {
    name:       document.getElementById('actName').value.trim(),
    icon:       document.getElementById('actIcon').value.trim() || null,
    sort_order: Number(document.getElementById('actSort').value) || 100,
  };
  if (!body.name) { showToast('Name required', true); return; }
  var url    = id ? (ATP_API + '/activities/admin/' + id) : (ATP_API + '/activities/admin');
  var method = id ? 'PATCH' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast(id ? '✅ Activity updated' : '✅ Activity created');
      cancelActivityForm();
      loadActivitiesAdmin();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}
function deleteActivity(e, btn) {
  if (!confirm('Deactivate this activity? (Members who already selected it keep it.)')) return;
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  fetch(ATP_API + '/activities/admin/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(){ showToast('✅ Activity deactivated'); loadActivitiesAdmin(); })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

// ════════════════════════════════════════════════════════════
// SYSTEM CONFIG (#27 + #31)
// ════════════════════════════════════════════════════════════

function loadSystemConfig() {
  fetch(ATP_API + '/admin/system-config', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){ renderSystemConfig((data && data.config) || []); })
    .catch(function(){ document.getElementById('configList').innerHTML =
      '<div style="padding:14px;color:#f87171">Failed to load config.</div>'; });
}

function renderSystemConfig(rows) {
  var el = document.getElementById('configList');
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No config keys yet.</div>'; return; }
  el.innerHTML = rows.map(function(r){
    // value is JSONB — display as raw JSON for honest editing
    var raw = (typeof r.value === 'string') ? r.value : JSON.stringify(r.value);
    return '<div style="display:grid;grid-template-columns:1fr 200px auto;gap:12px;padding:14px;border-bottom:1px solid #1a1a1a;align-items:center">' +
      '<div>' +
        '<div style="font-size:13px;font-weight:700;color:#fff">' + (r.label || r.key) + '</div>' +
        '<div style="font-size:11px;color:#666;font-family:monospace;margin-top:2px">' + r.key + '</div>' +
        (r.description ? '<div style="font-size:11px;color:#888;margin-top:4px;line-height:1.5">' + r.description + '</div>' : '') +
      '</div>' +
      '<input class="admin-form-input" id="cfg-' + r.key + '" value="' + (raw || '').replace(/"/g, '&quot;') + '" style="font-family:monospace;font-size:12px">' +
      '<button class="admin-btn admin-btn-primary" style="font-size:11px;padding:7px 14px" data-atp-call="saveConfigKey" data-args=\'["' + r.key + '"]\'>Save</button>' +
    '</div>';
  }).join('');
}

function saveConfigKey(e, btn) {
  var key = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  var input = document.getElementById('cfg-' + key);
  if (!input) return;
  var raw = input.value.trim();
  // Try JSON.parse so '"AED"', '50', 'true' are all valid; fall back to raw string
  var value;
  try { value = JSON.parse(raw); } catch (e) { value = raw; }
  fetch(ATP_API + '/admin/system-config/' + encodeURIComponent(key), {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify({ value: value }),
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Saved: ' + key);
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}
