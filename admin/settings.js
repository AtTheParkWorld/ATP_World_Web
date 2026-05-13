/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Settings (Theme 5b)
 * Three sub-tabs in one section: Announcements, Activities, System Config.
 * Each one is a thin CRUD wrapping the corresponding /api/* endpoints.
 * Loaded via showAdminSection('settings') hook in init.js.
 * ════════════════════════════════════════════════════════════════ */

// ── Sub-tab switcher ─────────────────────────────────────────
function showSettingsTab(tab) {
  ['announcements','activities','achievements','config','plans','countries','maintenance'].forEach(function(t){
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
  else if (tab === 'countries')    loadCountriesAdmin();
  else if (tab === 'streaming')    loadStreamingAdmin();
  else if (tab === 'maintenance')  loadMaintenanceTab();
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

var ACTIVITY_TRIBES_CACHE = null;
function _loadActivityTribesOptions() {
  // Populate the tribe dropdown on the activity form. Cached per page load.
  var sel = document.getElementById('actTribe');
  if (!sel) return Promise.resolve([]);
  if (ACTIVITY_TRIBES_CACHE) {
    sel.innerHTML = '<option value="">No tribe</option>' +
      ACTIVITY_TRIBES_CACHE.map(function(t){
        return '<option value="' + t.id + '">' + (t.name || '').replace(/</g,'&lt;') + '</option>';
      }).join('');
    return Promise.resolve(ACTIVITY_TRIBES_CACHE);
  }
  return fetch(ATP_API + '/sessions/tribes')
    .then(function(r){ return r.ok ? r.json() : { tribes: [] }; })
    .then(function(d){
      ACTIVITY_TRIBES_CACHE = (d && d.tribes) || [];
      sel.innerHTML = '<option value="">No tribe</option>' +
        ACTIVITY_TRIBES_CACHE.map(function(t){
          return '<option value="' + t.id + '">' + (t.name || '').replace(/</g,'&lt;') + '</option>';
        }).join('');
      return ACTIVITY_TRIBES_CACHE;
    })
    .catch(function(){ return []; });
}

function loadActivitiesAdmin() {
  _loadActivityTribesOptions();
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
        var tribe = a.tribe_name
          ? '<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:20px;background:rgba(122,194,49,.12);color:#7AC231;border:1px solid rgba(122,194,49,.3);margin-bottom:6px">' + a.tribe_name.replace(/</g,'&lt;') + '</span>'
          : '<span style="display:inline-block;font-size:10px;color:#666;margin-bottom:6px">No tribe</span>';
        return '<div style="background:#0d0d0d;border:1px solid ' + border + ';border-radius:10px;padding:14px;opacity:' + op + '">' +
          '<div style="font-size:24px;margin-bottom:8px">' + icon + '</div>' +
          '<div>' + tribe + '</div>' +
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
  _loadActivityTribesOptions().then(function(){
    var t = document.getElementById('actTribe'); if (t) t.value = '';
  });
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
      _loadActivityTribesOptions().then(function(){
        var t = document.getElementById('actTribe');
        if (t) t.value = a.tribe_id || '';
      });
    });
}
function saveActivity() {
  var id = document.getElementById('actEditId').value;
  var body = {
    name:       document.getElementById('actName').value.trim(),
    icon:       document.getElementById('actIcon').value.trim() || null,
    sort_order: Number(document.getElementById('actSort').value) || 100,
    tribe_id:   document.getElementById('actTribe').value || null,
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
  if (document.getElementById('planAnnualStripePriceId')) document.getElementById('planAnnualStripePriceId').value = '';
  if (document.getElementById('planAnnualAmount'))        document.getElementById('planAnnualAmount').value        = '';
  if (document.getElementById('planAnnualSavingsLabel'))  document.getElementById('planAnnualSavingsLabel').value  = '';
  if (document.getElementById('planCountry')) document.getElementById('planCountry').value = '';
  document.getElementById('planFormTitle').textContent = 'New plan';
  document.getElementById('planFormWrap').style.display = 'block';
  populatePlanCountryDropdown(); // refresh in case admin just added a country
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
  if (document.getElementById('planAnnualStripePriceId')) document.getElementById('planAnnualStripePriceId').value = p.annual_stripe_price_id || '';
  if (document.getElementById('planAnnualAmount'))        document.getElementById('planAnnualAmount').value        = p.annual_amount_cents != null ? p.annual_amount_cents : '';
  if (document.getElementById('planAnnualSavingsLabel'))  document.getElementById('planAnnualSavingsLabel').value  = p.annual_savings_label || '';
  if (document.getElementById('planCountry')) {
    populatePlanCountryDropdown(p.country_id || '');
  }
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
  var annualAmtRaw = (document.getElementById('planAnnualAmount') || {}).value;
  var body = {
    name:                   (document.getElementById('planName').value || '').trim(),
    tagline:                (document.getElementById('planTagline').value || '').trim() || null,
    description:            (document.getElementById('planDescription').value || '').trim() || null,
    stripe_price_id:        (document.getElementById('planStripePriceId').value || '').trim() || null,
    amount_cents:           parseInt(document.getElementById('planAmount').value, 10) || 0,
    currency:               (document.getElementById('planCurrency').value || 'aed').toLowerCase().trim(),
    interval:               document.getElementById('planInterval').value === 'year' ? 'year' : 'month',
    features:               features.length ? features : null,
    sort_order:             parseInt(document.getElementById('planSort').value, 10) || 100,
    is_active:              document.getElementById('planActive').checked,
    country_id:             (document.getElementById('planCountry') && document.getElementById('planCountry').value) || null,
    annual_amount_cents:    annualAmtRaw === '' || annualAmtRaw == null ? null : (parseInt(annualAmtRaw, 10) || 0),
    annual_stripe_price_id: ((document.getElementById('planAnnualStripePriceId') || {}).value || '').trim() || null,
    annual_savings_label:   ((document.getElementById('planAnnualSavingsLabel')   || {}).value || '').trim() || null,
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

// ════════════════════════════════════════════════════════════
// COUNTRIES (Theme 8 / #28, #29)
// ════════════════════════════════════════════════════════════
// Map ISO country code → currency + symbol + ATP-points-per-unit override.
// Drives the wallet display currency, the plan country filter, and
// (eventually) per-country store inventory.

var ATP_COUNTRIES_CACHE = [];

function loadCountriesAdmin() {
  fetch(ATP_API + '/countries/admin', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(data){
      ATP_COUNTRIES_CACHE = (data && data.countries) || [];
      renderCountriesAdmin(ATP_COUNTRIES_CACHE);
    })
    .catch(function(){ document.getElementById('countriesList').innerHTML =
      '<div style="padding:14px;color:#f87171">Failed to load countries.</div>'; });
}

function renderCountriesAdmin(list) {
  var el = document.getElementById('countriesList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No countries yet. Run the migrate-countries setup or click + New country.</div>';
    return;
  }
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse">' +
      '<thead><tr style="font-size:11px;color:#666;text-align:left;border-bottom:1px solid #1a1a1a">' +
        '<th style="padding:10px">Status</th>' +
        '<th style="padding:10px">Code</th>' +
        '<th style="padding:10px">Name</th>' +
        '<th style="padding:10px">Currency</th>' +
        '<th style="padding:10px">Symbol</th>' +
        '<th style="padding:10px;text-align:right">pts / unit</th>' +
        '<th style="padding:10px;text-align:right">Sort</th>' +
        '<th style="padding:10px"></th>' +
      '</tr></thead><tbody>' +
      list.map(function(c){
        var name = (c.name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var statusBadge = c.is_active
          ? '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(122,194,49,.15);color:#7AC231">Active</span>'
          : '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.06);color:#666">Off</span>';
        var rate = (c.atp_per_unit != null && c.atp_per_unit !== '') ? c.atp_per_unit : '<span style="color:#666">global default</span>';
        return '<tr style="border-bottom:1px solid #111;font-size:13px">' +
          '<td style="padding:10px">' + statusBadge + '</td>' +
          '<td style="padding:10px;color:#fff;font-family:monospace;font-weight:700">' + (c.code || '—') + '</td>' +
          '<td style="padding:10px;color:#fff">' + name + '</td>' +
          '<td style="padding:10px;color:#aaa;font-family:monospace">' + (c.currency_code || '—') + '</td>' +
          '<td style="padding:10px;color:#aaa">' + (c.currency_symbol || '—') + '</td>' +
          '<td style="padding:10px;text-align:right;color:#aaa">' + rate + '</td>' +
          '<td style="padding:10px;text-align:right;color:#aaa">' + (c.sort_order || 0) + '</td>' +
          '<td style="padding:10px;text-align:right;white-space:nowrap">' +
            '<button class="admin-btn" style="font-size:11px;padding:5px 10px;margin-right:4px" data-atp-call="editCountry" data-args=\'["' + c.id + '"]\'>Edit</button>' +
            '<button class="admin-btn admin-btn-danger" style="font-size:11px;padding:5px 10px" data-atp-call="deactivateCountry" data-args=\'["' + c.id + '"]\'>Deactivate</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
    '</tbody></table>';
}

function showCountryForm() {
  document.getElementById('countryEditId').value          = '';
  document.getElementById('countryCode').value             = '';
  document.getElementById('countryName').value             = '';
  document.getElementById('countryCurrencyCode').value     = '';
  document.getElementById('countryCurrencySymbol').value   = '';
  document.getElementById('countryAtp').value              = '';
  document.getElementById('countrySort').value             = 100;
  document.getElementById('countryActive').checked         = true;
  document.getElementById('countryFormTitle').textContent  = 'New country';
  document.getElementById('countryFormWrap').style.display = 'block';
}

function editCountry(id) {
  var c = ATP_COUNTRIES_CACHE.find(function(x){ return x.id === id; });
  if (!c) return;
  document.getElementById('countryEditId').value          = c.id;
  document.getElementById('countryCode').value             = c.code || '';
  document.getElementById('countryName').value             = c.name || '';
  document.getElementById('countryCurrencyCode').value     = c.currency_code || '';
  document.getElementById('countryCurrencySymbol').value   = c.currency_symbol || '';
  document.getElementById('countryAtp').value              = (c.atp_per_unit != null) ? c.atp_per_unit : '';
  document.getElementById('countrySort').value             = c.sort_order || 100;
  document.getElementById('countryActive').checked         = !!c.is_active;
  document.getElementById('countryFormTitle').textContent  = 'Edit country';
  document.getElementById('countryFormWrap').style.display = 'block';
}

function cancelCountryForm() {
  document.getElementById('countryFormWrap').style.display = 'none';
}

function saveCountry() {
  var id = document.getElementById('countryEditId').value;
  var atpRaw = document.getElementById('countryAtp').value;
  var body = {
    code:            (document.getElementById('countryCode').value || '').trim().toUpperCase(),
    name:            (document.getElementById('countryName').value || '').trim(),
    currency_code:   (document.getElementById('countryCurrencyCode').value || '').trim().toUpperCase(),
    currency_symbol: (document.getElementById('countryCurrencySymbol').value || '').trim(),
    atp_per_unit:    atpRaw === '' ? null : Math.max(1, parseInt(atpRaw, 10) || 1),
    sort_order:      parseInt(document.getElementById('countrySort').value, 10) || 100,
    is_active:       document.getElementById('countryActive').checked,
  };
  if (!body.code || !/^[A-Z]{2}$/.test(body.code)) { showToast('Code must be 2 letters (e.g. AE)', true); return; }
  if (!body.name) { showToast('Name required', true); return; }
  if (!body.currency_code) { showToast('Currency required', true); return; }
  if (!body.currency_symbol) body.currency_symbol = body.currency_code;

  var url = id ? (ATP_API + '/countries/' + id) : (ATP_API + '/countries');
  var method = id ? 'PATCH' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Country saved');
      cancelCountryForm();
      loadCountriesAdmin();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

function deactivateCountry(id) {
  if (!confirm('Deactivate this country? Existing members keep their setting; the country just won\'t appear on signup or upgrade pages.')) return;
  fetch(ATP_API + '/countries/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Country deactivated');
      loadCountriesAdmin();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

// ════════════════════════════════════════════════════════════
// MAINTENANCE (Theme 13) — pending booking cleanup + refund retry
// ════════════════════════════════════════════════════════════

function loadMaintenanceTab() {
  loadPendingBookings();
  loadFailedRefunds();
}

function loadPendingBookings() {
  var el = document.getElementById('pendingBookingsList');
  if (!el) return;
  fetch(ATP_API + '/admin/maintenance/pending-bookings', {
    headers: { 'Authorization': 'Bearer ' + getToken() }
  }).then(function(r){ return r.json(); }).then(function(data){
    var rows = (data && data.pending) || [];
    if (!rows.length) {
      el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No pending-payment bookings older than 1 hour. \u2728</div>';
      return;
    }
    el.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="color:#666;text-align:left;border-bottom:1px solid #1a1a1a"><th style="padding:8px 6px">Member</th><th style="padding:8px 6px">Session</th><th style="padding:8px 6px;text-align:right">Pending for</th><th style="padding:8px 6px;text-align:right">Created</th></tr></thead>' +
      '<tbody>' +
        rows.map(function(p){
          var nameSafe = ((p.first_name||'') + ' ' + (p.last_name||'')).trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || p.email;
          var sessionSafe = (p.session_name || 'Session').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          var hours = Number(p.hours_pending) || 0;
          var color = hours > 24 ? '#f87171' : (hours > 6 ? '#ffc400' : '#aaa');
          var createdAt = p.created_at ? new Date(p.created_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
          return '<tr style="border-bottom:1px solid #111">' +
            '<td style="padding:8px 6px;color:#fff">' + nameSafe + '<div style="font-size:10px;color:#666">' + (p.email||'') + '</div></td>' +
            '<td style="padding:8px 6px;color:#aaa">' + sessionSafe + '</td>' +
            '<td style="padding:8px 6px;text-align:right;color:' + color + ';font-weight:700">' + hours.toFixed(1) + 'h</td>' +
            '<td style="padding:8px 6px;text-align:right;color:#666;font-size:11px">' + createdAt + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>' +
      '<div style="margin-top:12px;font-size:11px;color:#666">' + rows.length + ' pending bookings</div>';
  }).catch(function(){
    el.innerHTML = '<div style="padding:14px;color:#f87171">Failed to load pending bookings.</div>';
  });
}

function cleanupPendingBookings() {
  if (!confirm('Cancel every pending_payment booking older than 24 hours? Members can rebook fresh if they still want.')) return;
  fetch(ATP_API + '/admin/maintenance/cleanup-pending-bookings', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); }).then(function(res){
    if (res && res.error) { showToast('❌ ' + res.error, true); return; }
    showToast('🧹 Cancelled ' + (res.cancelled_count || 0) + ' bookings');
    loadPendingBookings();
  }).catch(function(e){ showToast('❌ ' + e.message, true); });
}

function loadFailedRefunds() {
  var el = document.getElementById('failedRefundsList');
  if (!el) return;
  fetch(ATP_API + '/admin/maintenance/failed-refunds', {
    headers: { 'Authorization': 'Bearer ' + getToken() }
  }).then(function(r){ return r.json(); }).then(function(data){
    var rows = (data && data.failed) || [];
    if (!rows.length) {
      el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No failed refunds. \u2728</div>';
      return;
    }
    el.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="color:#666;text-align:left;border-bottom:1px solid #1a1a1a"><th style="padding:8px 6px">Member</th><th style="padding:8px 6px">Session</th><th style="padding:8px 6px;text-align:right">Amount</th><th style="padding:8px 6px;text-align:right">Cancelled</th><th style="padding:8px 6px"></th></tr></thead>' +
      '<tbody>' +
        rows.map(function(p){
          var nameSafe = ((p.first_name||'') + ' ' + (p.last_name||'')).trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || p.email;
          var sessionSafe = (p.session_name || 'Session').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          var amount = (p.payment_currency || 'AED').toUpperCase() + ' ' + Number(p.payment_amount || 0).toFixed(2);
          var cancelledAt = p.cancelled_at ? new Date(p.cancelled_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
          return '<tr style="border-bottom:1px solid #111">' +
            '<td style="padding:8px 6px;color:#fff">' + nameSafe + '<div style="font-size:10px;color:#666">' + (p.email||'') + '</div></td>' +
            '<td style="padding:8px 6px;color:#aaa">' + sessionSafe + '</td>' +
            '<td style="padding:8px 6px;text-align:right;color:#fff;font-weight:700">' + amount + '</td>' +
            '<td style="padding:8px 6px;text-align:right;color:#666;font-size:11px">' + cancelledAt + '</td>' +
            '<td style="padding:8px 6px;text-align:right">' +
              '<button class="admin-btn admin-btn-primary" style="font-size:11px;padding:5px 10px" onclick="retryRefund(this.dataset.id)" data-id="' + p.id + '">↻ Retry refund</button>' +
            '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>' +
      '<div style="margin-top:12px;font-size:11px;color:#666">' + rows.length + ' bookings need refunding</div>';
  }).catch(function(){
    el.innerHTML = '<div style="padding:14px;color:#f87171">Failed to load.</div>';
  });
}

function retryRefund(bookingId) {
  if (!bookingId) return;
  if (!confirm('Issue a Stripe refund for this booking?')) return;
  fetch(ATP_API + '/bookings/' + bookingId + '/retry-refund', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json().then(function(b){ return { ok:r.ok, body:b }; }); })
    .then(function(res){
      if (!res.ok || (res.body && res.body.error)) {
        showToast('❌ ' + ((res.body && res.body.error) || 'Refund failed'), true);
        return;
      }
      showToast('💸 Refund issued: ' + (res.body.refunded_currency || 'AED') + ' ' + Number(res.body.refunded_amount || 0).toFixed(2));
      loadFailedRefunds();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

// Helper used by the Plans form to populate the Country dropdown. Pulls
// the public list (active only). Always cheap — single GET, no auth.
function populatePlanCountryDropdown(selectedId) {
  var sel = document.getElementById('planCountry');
  if (!sel) return;
  fetch(ATP_API + '/countries')
    .then(function(r){ return r.ok ? r.json() : { countries: [] }; })
    .then(function(data){
      var list = (data && data.countries) || [];
      sel.innerHTML = '<option value="">🌍 Global (all countries)</option>' +
        list.map(function(c){
          return '<option value="' + c.id + '">' + (c.code || '??') + ' — ' + (c.name||'') + ' (' + (c.currency_code||'') + ')</option>';
        }).join('');
      if (selectedId) sel.value = selectedId;
    })
    .catch(function(){});
}

// ── STREAMING TAB ───────────────────────────────────────────
// Combines two panels: top dashboard tiles pulled from
// /api/streams/admin/analytics, and the ads CRUD below. Polled
// every 10s so the founder can see concurrent viewers tick live.
var STREAM_ADS_CACHE = [];
var _streamDashTimer = null;

function loadStreamingAdmin() {
  loadStreamDashboard();
  loadStreamAdsList();
  // Live polling — only while the tab is visible, so we don't burn
  // requests when the admin clicks elsewhere.
  if (_streamDashTimer) clearInterval(_streamDashTimer);
  _streamDashTimer = setInterval(function() {
    var pane = document.getElementById('settings-pane-streaming');
    if (!pane || pane.style.display === 'none') {
      clearInterval(_streamDashTimer); _streamDashTimer = null;
      return;
    }
    loadStreamDashboard();
  }, 10_000);
}

function loadStreamDashboard() {
  fetch(ATP_API + '/streams/admin/analytics', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if (!d) return;
      var live = d.live || {};
      var w    = d.last_7d || {};
      var setText = function(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; };
      var fmt = function(n){ return (n == null ? 0 : n).toLocaleString(); };
      var fmtSec = function(s) {
        s = parseInt(s, 10) || 0;
        if (s < 60) return s + 's';
        var m = Math.floor(s / 60), r = s % 60;
        if (m < 60) return m + 'm ' + (r ? r + 's' : '');
        var h = Math.floor(m / 60), rm = m % 60;
        return h + 'h ' + rm + 'm';
      };
      setText('dashLiveCount',   fmt(live.streams_live || 0));
      setText('dashConcurrent',  fmt(live.concurrent_viewers || 0));
      setText('dash7dStreams',   fmt(w.streams || 0));
      setText('dash7dUnique',    fmt(w.unique_viewers || 0));
      setText('dash7dAvg',       fmtSec(w.avg_view_seconds || 0));
    })
    .catch(function(){});
}

function loadStreamAdsList() {
  fetch(ATP_API + '/streams/admin/ads', { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function(r){ return r.ok ? r.json() : { ads: [] }; })
    .then(function(d){
      STREAM_ADS_CACHE = (d && d.ads) || [];
      renderStreamAdsList(STREAM_ADS_CACHE);
    })
    .catch(function(){
      var el = document.getElementById('streamAdsList');
      if (el) el.innerHTML = '<div style="padding:14px;color:#f87171">Failed to load ads.</div>';
    });
}

function renderStreamAdsList(list) {
  var el = document.getElementById('streamAdsList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:18px;color:#666;text-align:center">No banner ads yet. Add one above to start monetising live streams.</div>';
    return;
  }
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse">' +
      '<thead><tr style="font-size:11px;color:#666;text-align:left;border-bottom:1px solid #1a1a1a">' +
        '<th style="padding:10px">Status</th>' +
        '<th style="padding:10px">Preview</th>' +
        '<th style="padding:10px">Name</th>' +
        '<th style="padding:10px">Weight</th>' +
        '<th style="padding:10px;text-align:right">Impressions · Clicks</th>' +
        '<th style="padding:10px"></th>' +
      '</tr></thead><tbody>' +
      list.map(function(a){
        var pill = a.is_active
          ? '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(122,194,49,.15);color:#7AC231">Active</span>'
          : '<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.06);color:#666">Off</span>';
        var imp = (a.impressions || 0).toLocaleString();
        var clk = (a.clicks || 0).toLocaleString();
        var ctr = a.impressions > 0 ? ((a.clicks / a.impressions) * 100).toFixed(2) + '%' : '—';
        return '<tr style="border-bottom:1px solid #111;font-size:13px">' +
          '<td style="padding:10px">' + pill + '</td>' +
          '<td style="padding:10px"><img src="' + esc(a.image_url) + '" alt="" style="height:34px;width:auto;max-width:140px;display:block;border-radius:4px;object-fit:cover" onerror="this.style.opacity=.3"></td>' +
          '<td style="padding:10px;color:#fff">' + esc(a.name) + '</td>' +
          '<td style="padding:10px;color:#aaa">' + (a.weight || 1) + '</td>' +
          '<td style="padding:10px;text-align:right;color:#aaa">' + imp + ' · ' + clk + ' <span style="color:#666">(' + ctr + ' CTR)</span></td>' +
          '<td style="padding:10px;text-align:right;white-space:nowrap">' +
            '<button class="admin-btn" style="font-size:11px;padding:5px 10px;margin-right:4px" data-atp-call="editStreamAd" data-args=\'["' + a.id + '"]\'>Edit</button>' +
            '<button class="admin-btn admin-btn-danger" style="font-size:11px;padding:5px 10px" data-atp-call="deactivateStreamAd" data-args=\'["' + a.id + '"]\'>Off</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
    '</tbody></table>';
}

function showStreamAdForm() {
  ['streamAdEditId','streamAdName','streamAdImage','streamAdClick','streamAdStartsAt','streamAdEndsAt'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('streamAdWeight').value = '1';
  document.getElementById('streamAdActive').checked = true;
  document.getElementById('streamAdFormTitle').textContent = 'New banner ad';
  document.getElementById('streamAdFormWrap').style.display = 'block';
}
function cancelStreamAdForm() {
  document.getElementById('streamAdFormWrap').style.display = 'none';
}

// Convert <input type="datetime-local"> string to ISO, or null when empty.
function _streamAdDt(v) {
  if (!v) return null;
  try { return new Date(v).toISOString(); } catch(e) { return null; }
}
// Convert an ISO back to the local datetime-local input format.
function _streamAdIsoToLocal(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    var pad = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  } catch(e) { return ''; }
}

function editStreamAd(e, btn) {
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  var a = STREAM_ADS_CACHE.find(function(x){ return x.id === id; });
  if (!a) return;
  document.getElementById('streamAdEditId').value     = a.id;
  document.getElementById('streamAdName').value        = a.name || '';
  document.getElementById('streamAdImage').value       = a.image_url || '';
  document.getElementById('streamAdClick').value       = a.click_url || '';
  document.getElementById('streamAdWeight').value      = a.weight || 1;
  document.getElementById('streamAdActive').checked    = !!a.is_active;
  document.getElementById('streamAdStartsAt').value    = _streamAdIsoToLocal(a.starts_at);
  document.getElementById('streamAdEndsAt').value      = _streamAdIsoToLocal(a.ends_at);
  document.getElementById('streamAdFormTitle').textContent = 'Edit banner ad';
  document.getElementById('streamAdFormWrap').style.display = 'block';
}

function saveStreamAd() {
  var id = document.getElementById('streamAdEditId').value;
  var body = {
    name:      (document.getElementById('streamAdName').value || '').trim(),
    image_url: (document.getElementById('streamAdImage').value || '').trim(),
    click_url: (document.getElementById('streamAdClick').value || '').trim() || null,
    weight:    parseInt(document.getElementById('streamAdWeight').value, 10) || 1,
    is_active: document.getElementById('streamAdActive').checked,
    starts_at: _streamAdDt(document.getElementById('streamAdStartsAt').value),
    ends_at:   _streamAdDt(document.getElementById('streamAdEndsAt').value),
  };
  if (!body.name || !body.image_url) { showToast('Name + image URL required', true); return; }
  var url    = id ? (ATP_API + '/streams/admin/ads/' + id) : (ATP_API + '/streams/admin/ads');
  var method = id ? 'PATCH' : 'POST';
  fetch(url, {
    method: method,
    headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Ad saved');
      cancelStreamAdForm();
      loadStreamAdsList();
    })
    .catch(function(e){ showToast('❌ ' + e.message, true); });
}

function deactivateStreamAd(e, btn) {
  if (!confirm('Deactivate this banner ad? (Stats are kept so you can re-enable it later.)')) return;
  var id = (btn && btn.getAttribute('data-args') || '').replace(/[\[\]"]/g, '');
  fetch(ATP_API + '/streams/admin/ads/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Ad deactivated');
      loadStreamAdsList();
    });
}
