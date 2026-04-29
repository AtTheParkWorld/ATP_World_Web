/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Settings (Theme 5b)
 * Three sub-tabs in one section: Announcements, Activities, System Config.
 * Each one is a thin CRUD wrapping the corresponding /api/* endpoints.
 * Loaded via showAdminSection('settings') hook in init.js.
 * ════════════════════════════════════════════════════════════════ */

// ── Sub-tab switcher ─────────────────────────────────────────
function showSettingsTab(tab) {
  ['announcements','activities','achievements','config','plans'].forEach(function(t){
    var pane = document.getElementById('settings-pane-' + t);
    if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
  });
  document.querySelectorAll('.settings-tab').forEach(function(b){
    var match = (b.getAttribute('data-args') || '').indexOf('"' + tab + '"') >= 0;
    b.style.borderBottomColor = match ? '#7AC231' : 'transparent';
    b.style.color = match ? '#fff' : '#888';
  });
  if (tab === 'announcements') loadAnnouncementsAdmin();
  else if (tab === 'activities')   loadActivitiesAdmin();
  else if (tab === 'achievements') loadAchievementsAdmin();
  else if (tab === 'config')       loadSystemConfig();
  else if (tab === 'plans')        loadPlansAdmin();
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
// ACHIEVEMENTS (#12)
// ════════════════════════════════════════════════════════════

function loadAchievementsAdmin() {
  fetch(ATP_API + '/achievements/admin', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){ renderAchievementsAdmin((data && data.achievements) || []); })
    .catch(function(){ document.getElementById('achievementsList').innerHTML =
      '<div style="padding:14px;color:#f87171">Failed to load achievements.</div>'; });
}

function renderAchievementsAdmin(list) {
  var el = document.getElementById('achievementsList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No achievements yet.</div>'; return; }
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">' +
      list.map(function(a){
        var name = (a.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var desc = (a.description || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var op = a.is_active ? '1' : '.45';
        var border = a.is_active ? 'rgba(122,194,49,.3)' : 'rgba(255,255,255,.08)';
        var iconHtml = a.badge_image_url
          ? '<img src="' + a.badge_image_url + '" style="width:48px;height:48px;object-fit:contain;display:block;margin-bottom:10px">'
          : '<div style="font-size:36px;margin-bottom:8px">' + (a.icon || '🏅') + '</div>';
        var trigger = (a.criteria_type === 'manual')
          ? 'Manual'
          : a.criteria_type + ' ≥ ' + (a.criteria_value || 0);
        return '<div style="background:#0d0d0d;border:1px solid ' + border + ';border-radius:10px;padding:14px;opacity:' + op + '">' +
          iconHtml +
          '<div style="font-size:13px;font-weight:700;margin-bottom:2px">' + name + '</div>' +
          '<div style="font-size:11px;color:#888;margin-bottom:8px;line-height:1.5">' + desc + '</div>' +
          '<div style="display:flex;gap:8px;font-size:10px;color:#aaa;margin-bottom:10px">' +
            '<span>+' + (a.points_reward || 0) + ' pts</span>' +
            '<span>·</span>' +
            '<span>' + trigger + '</span>' +
            '<span>·</span>' +
            '<span>' + (a.unlocked_count || 0) + ' unlocked</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="admin-btn" style="font-size:11px;padding:5px 10px;flex:1" data-atp-call="editAchievement" data-args=\'["' + a.id + '"]\'>Edit</button>' +
            '<button class="admin-btn" style="font-size:11px;padding:5px 10px" data-atp-call="awardAchievementPrompt" data-args=\'["' + a.id + '"]\' title="Manually award to a member">+👤</button>' +
            '<button class="admin-btn admin-btn-danger" style="font-size:11px;padding:5px 10px" data-atp-call="deleteAchievement" data-args=\'["' + a.id + '"]\'>×</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
}

function showAchievementForm() {
  document.getElementById('achievementFormWrap').style.display = 'block';
  document.getElementById('achievementFormTitle').textContent = 'New achievement';
  ['achEditId','achName','achDesc','achIcon','achBadge'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('achCriteriaType').value = 'manual';
  document.getElementById('achCriteriaValue').value = '0';
  document.getElementById('achPoints').value = '0';
  document.getElementById('achSort').value = '100';
  document.getElementById('achActive').checked = true;
  document.getElementById('achName').focus();
}
function cancelAchievementForm() {
  document.getElementById('achievementFormWrap').style.display = 'none';
}
function editAchievement(e, btn) {
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  fetch(ATP_API + '/achievements/admin', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var a = ((data && data.achievements) || []).find(function(x){ return x.id === id; });
      if (!a) { showToast('Achievement not found', true); return; }
      document.getElementById('achievementFormWrap').style.display = 'block';
      document.getElementById('achievementFormTitle').textContent = 'Edit achievement';
      document.getElementById('achEditId').value       = id;
      document.getElementById('achName').value         = a.name || '';
      document.getElementById('achDesc').value         = a.description || '';
      document.getElementById('achIcon').value         = a.icon || '';
      document.getElementById('achBadge').value        = a.badge_image_url || '';
      document.getElementById('achCriteriaType').value = a.criteria_type || 'manual';
      document.getElementById('achCriteriaValue').value = a.criteria_value || 0;
      document.getElementById('achPoints').value       = a.points_reward || 0;
      document.getElementById('achSort').value         = a.sort_order || 100;
      document.getElementById('achActive').checked     = !!a.is_active;
    });
}
function saveAchievement() {
  var id = document.getElementById('achEditId').value;
  var body = {
    name:            document.getElementById('achName').value.trim(),
    description:     document.getElementById('achDesc').value.trim() || null,
    icon:            document.getElementById('achIcon').value.trim() || null,
    badge_image_url: document.getElementById('achBadge').value.trim() || null,
    criteria_type:   document.getElementById('achCriteriaType').value,
    criteria_value:  Number(document.getElementById('achCriteriaValue').value) || null,
    points_reward:   Number(document.getElementById('achPoints').value) || 0,
    sort_order:      Number(document.getElementById('achSort').value) || 100,
    is_active:       document.getElementById('achActive').checked,
  };
  if (!body.name) { showToast('Name required', true); return; }
  var url    = id ? (ATP_API + '/achievements/admin/' + id) : (ATP_API + '/achievements/admin');
  var method = id ? 'PATCH' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast(id ? '✅ Achievement updated' : '✅ Achievement created');
      cancelAchievementForm();
      loadAchievementsAdmin();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}
function deleteAchievement(e, btn) {
  if (!confirm('Deactivate this achievement? Existing unlocks are preserved.')) return;
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  fetch(ATP_API + '/achievements/admin/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(){ showToast('✅ Achievement deactivated'); loadAchievementsAdmin(); })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}
function awardAchievementPrompt(e, btn) {
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  var memberInput = prompt('Member ID, member number, or email to award this achievement to:');
  if (!memberInput) return;
  // Search the member by any of the three identifiers
  fetch(ATP_API + '/admin/members?search=' + encodeURIComponent(memberInput.trim()) + '&limit=1', {
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(data){
      var m = (data && data.members && data.members[0]);
      if (!m) { showToast('Member not found', true); return; }
      if (!confirm('Award to ' + m.first_name + ' ' + m.last_name + '?')) return;
      return fetch(ATP_API + '/achievements/admin/award', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
        body: JSON.stringify({ member_id: m.id, achievement_id: id }),
      }).then(function(r){ return r.json(); }).then(function(res){
        if (res && res.error) { showToast('❌ ' + res.error, true); return; }
        showToast(res.awarded ? ('✅ Awarded to ' + m.first_name) : 'Already had it');
        loadAchievementsAdmin();
      });
    })
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

// ════════════════════════════════════════════════════════════
// SUBSCRIPTION PLANS (Theme 10 / #36 + Theme 5d / #37)
// ════════════════════════════════════════════════════════════
// Each plan mirrors a Stripe Price. Admin creates the Product+Price in
// the Stripe Dashboard, then pastes the price_… id here. The plan list
// powers the upgrade card on /profile via GET /api/billing/plans.

var ATP_PLANS_CACHE = [];

function loadPlansAdmin() {
  fetch(ATP_API + '/billing/admin/plans', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){
      ATP_PLANS_CACHE = (data && data.plans) || [];
      renderPlansAdmin(ATP_PLANS_CACHE);
    })
    .catch(function(){ document.getElementById('plansList').innerHTML =
      '<div style="padding:14px;color:#f87171">Failed to load plans.</div>'; });
}

function renderPlansAdmin(list) {
  var el = document.getElementById('plansList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No plans yet. Create one above to start charging members for premium.</div>';
    return;
  }
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse">' +
      '<thead><tr style="font-size:11px;color:#666;text-align:left;border-bottom:1px solid #1a1a1a">' +
        '<th style="padding:10px">Status</th><th style="padding:10px">Name</th>' +
        '<th style="padding:10px">Price</th><th style="padding:10px">Stripe price id</th>' +
        '<th style="padding:10px;text-align:right">Sort</th><th style="padding:10px"></th>' +
      '</tr></thead><tbody>' +
      list.map(function(p){
        var name = (p.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var statusBadge = p.is_active
          ? '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(122,194,49,.15);color:#7AC231">Active</span>'
          : '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.06);color:#666">Off</span>';
        var price = p.amount_cents
          ? (p.currency || 'aed').toUpperCase() + ' ' + (p.amount_cents/100).toFixed(2) + ' / ' + (p.interval || 'month')
          : '<span style="color:#666">—</span>';
        var priceId = p.stripe_price_id
          ? '<code style="font-size:10px;color:#7AC231;font-family:monospace">' + p.stripe_price_id + '</code>'
          : '<span style="font-size:11px;color:#f87171">⚠️ not connected</span>';
        return '<tr style="border-bottom:1px solid #111;font-size:13px">' +
          '<td style="padding:10px">' + statusBadge + '</td>' +
          '<td style="padding:10px;color:#fff">' + name +
            (p.tagline ? '<div style="font-size:11px;color:#888;margin-top:2px">' + p.tagline + '</div>' : '') +
          '</td>' +
          '<td style="padding:10px;color:#aaa">' + price + '</td>' +
          '<td style="padding:10px">' + priceId + '</td>' +
          '<td style="padding:10px;text-align:right;color:#aaa">' + (p.sort_order || 0) + '</td>' +
          '<td style="padding:10px;text-align:right;white-space:nowrap">' +
            '<button class="admin-btn" style="font-size:11px;padding:5px 10px;margin-right:4px" data-atp-call="editPlan" data-args=\'["' + p.id + '"]\'>Edit</button>' +
            '<button class="admin-btn admin-btn-danger" style="font-size:11px;padding:5px 10px" data-atp-call="deactivatePlan" data-args=\'["' + p.id + '"]\'>Deactivate</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
    '</tbody></table>';
}

function showPlanForm() {
  document.getElementById('planEditId').value      = '';
  document.getElementById('planName').value         = '';
  document.getElementById('planTagline').value      = '';
  document.getElementById('planDescription').value  = '';
  document.getElementById('planFeatures').value     = '';
  document.getElementById('planStripePriceId').value = '';
  document.getElementById('planAmount').value       = 0;
  document.getElementById('planCurrency').value     = 'aed';
  document.getElementById('planInterval').value     = 'month';
  document.getElementById('planSort').value         = 100;
  document.getElementById('planActive').checked     = true;
  document.getElementById('planFormTitle').textContent = 'New plan';
  document.getElementById('planFormWrap').style.display = 'block';
}

function editPlan(id) {
  var p = ATP_PLANS_CACHE.find(function(x){ return x.id === id; });
  if (!p) return;
  document.getElementById('planEditId').value         = p.id;
  document.getElementById('planName').value           = p.name || '';
  document.getElementById('planTagline').value        = p.tagline || '';
  document.getElementById('planDescription').value    = p.description || '';
  // features stored as JSON array; render one per line for editing
  var feats = '';
  try { feats = (Array.isArray(p.features) ? p.features : (p.features ? JSON.parse(p.features) : [])).join('\n'); }
  catch(e) { feats = ''; }
  document.getElementById('planFeatures').value       = feats;
  document.getElementById('planStripePriceId').value  = p.stripe_price_id || '';
  document.getElementById('planAmount').value         = p.amount_cents || 0;
  document.getElementById('planCurrency').value       = p.currency || 'aed';
  document.getElementById('planInterval').value       = p.interval || 'month';
  document.getElementById('planSort').value           = p.sort_order || 100;
  document.getElementById('planActive').checked       = !!p.is_active;
  document.getElementById('planFormTitle').textContent = 'Edit plan';
  document.getElementById('planFormWrap').style.display = 'block';
}

function cancelPlanForm() {
  document.getElementById('planFormWrap').style.display = 'none';
}

function savePlan() {
  var id = document.getElementById('planEditId').value;
  var featsRaw = document.getElementById('planFeatures').value || '';
  var features = featsRaw.split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean);
  var body = {
    name:            (document.getElementById('planName').value || '').trim(),
    tagline:         (document.getElementById('planTagline').value || '').trim() || null,
    description:     (document.getElementById('planDescription').value || '').trim() || null,
    stripe_price_id: (document.getElementById('planStripePriceId').value || '').trim() || null,
    amount_cents:    parseInt(document.getElementById('planAmount').value, 10) || 0,
    currency:        (document.getElementById('planCurrency').value || 'aed').toLowerCase().trim(),
    interval:        document.getElementById('planInterval').value === 'year' ? 'year' : 'month',
    features:        features.length ? features : null,
    sort_order:      parseInt(document.getElementById('planSort').value, 10) || 100,
    is_active:       document.getElementById('planActive').checked,
  };
  if (!body.name) { showToast('Plan name required', true); return; }

  var url = id ? (ATP_API + '/billing/admin/plans/' + id) : (ATP_API + '/billing/admin/plans');
  var method = id ? 'PATCH' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Plan saved');
      cancelPlanForm();
      loadPlansAdmin();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

function deactivatePlan(id) {
  if (!confirm('Deactivate this plan? Existing subscribers keep their access; the plan just won\'t appear on the upgrade page anymore.')) return;
  fetch(ATP_API + '/billing/admin/plans/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Plan deactivated');
      loadPlansAdmin();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}
