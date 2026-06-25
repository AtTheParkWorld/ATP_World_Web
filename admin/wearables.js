/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Wearables
 * Manages the wearable integration roster, provider config check,
 * and the sync audit log.
 * ════════════════════════════════════════════════════════════════ */

var WEARABLES_ACTIVE_TAB = 'connections';

// Sub-tab switching
document.addEventListener('click', function(ev) {
  var btn = ev.target.closest('.wearables-subtab');
  if (!btn) return;
  var tab = btn.getAttribute('data-wearables-tab');
  if (!tab || tab === WEARABLES_ACTIVE_TAB) return;
  WEARABLES_ACTIVE_TAB = tab;
  document.querySelectorAll('.wearables-subtab').forEach(function(b) {
    var on = b.getAttribute('data-wearables-tab') === tab;
    b.style.background  = on ? 'rgba(168,255,0,.12)' : 'transparent';
    b.style.color       = on ? '#A8FF00' : '#888';
    b.style.borderColor = on ? 'rgba(168,255,0,.3)' : '#2a2a2a';
    b.classList.toggle('active', on);
  });
  document.querySelectorAll('.wearables-pane').forEach(function(p) {
    p.style.display = (p.id === 'wearables-pane-' + tab) ? '' : 'none';
  });
  if (tab === 'connections')   loadWearableConnections();
  else if (tab === 'providers') loadWearableProviders();
  else if (tab === 'synclog')   loadWearableSyncLog();
});

// ── Connections roster ─────────────────────────────────────────
function loadWearableConnections() {
  fetch(ATP_API + '/wearables/admin/connections', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){ renderWearableConnections((d && d.connections) || []); })
    .catch(function(){
      document.getElementById('wearableConnectionsList').innerHTML =
        '<div style="padding:14px;color:#f87171">Failed to load connections. Has the wearables migration been run?</div>';
    });
}

function renderWearableConnections(list) {
  var el = document.getElementById('wearableConnectionsList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:30px;color:#555;text-align:center;font-size:13px">No wearable connections yet. Members can connect Strava/Fitbit/Polar/Withings from their profile Devices tab once providers are enabled.</div>';
    return;
  }
  el.innerHTML =
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="text-align:left;color:#888;border-bottom:1px solid #2a2a2a">' +
        '<th style="padding:8px 10px">Member</th>' +
        '<th style="padding:8px 10px">Provider</th>' +
        '<th style="padding:8px 10px">Status</th>' +
        '<th style="padding:8px 10px">Workouts</th>' +
        '<th style="padding:8px 10px">Last sync</th>' +
        '<th style="padding:8px 10px">Connected</th>' +
        '<th style="padding:8px 10px">Actions</th>' +
      '</tr></thead><tbody>' +
      list.map(function(c){
        var statusColor = c.status === 'active' ? '#A8FF00' : (c.status === 'needs_reauth' ? '#f5c042' : '#666');
        return (
          '<tr style="border-bottom:1px solid #1a1a1a">' +
            '<td style="padding:10px;color:#fff">' + _escW((c.first_name||'') + ' ' + (c.last_name||'')) + '<div style="font-size:10px;color:#666">' + _escW(c.email||'') + '</div></td>' +
            '<td style="padding:10px;color:#ccc;text-transform:capitalize">' + _escW(c.provider) + '</td>' +
            '<td style="padding:10px;color:' + statusColor + ';font-weight:600">' + _escW(c.status) + (c.last_error ? '<div style="font-size:10px;color:#f87171;margin-top:2px" title="' + _escW(c.last_error) + '">' + _escW(c.last_error.slice(0, 60)) + '…</div>' : '') + '</td>' +
            '<td style="padding:10px;color:#fff;text-align:center">' + (c.workout_count || 0) + '</td>' +
            '<td style="padding:10px;color:#888">' + (c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : '—') + '</td>' +
            '<td style="padding:10px;color:#888">' + new Date(c.connected_at).toLocaleDateString() + '</td>' +
            '<td style="padding:10px"><button class="admin-btn" data-atp-call="resyncWearable" data-args=\'["' + c.id + '"]\' style="font-size:11px;padding:5px 10px">↻ Resync</button></td>' +
          '</tr>'
        );
      }).join('') +
    '</tbody></table></div>';
}

function resyncWearable(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  btn.textContent = 'Syncing…';
  fetch(ATP_API + '/wearables/admin/resync/' + id, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.success) {
        showToast('✅ Synced · ' + (d.workouts || 0) + ' workouts · ' + (d.metrics || 0) + ' metrics');
        loadWearableConnections();
      } else {
        showToast('❌ ' + ((d && d.error) || 'Sync failed'), true);
        btn.textContent = '↻ Resync';
      }
    })
    .catch(function(){ showToast('❌ Sync failed', true); btn.textContent = '↻ Resync'; });
}

// ── Provider status grid ───────────────────────────────────────
function loadWearableProviders() {
  fetch(ATP_API + '/wearables/providers')
    .then(function(r){ return r.json(); })
    .then(function(d){ renderWearableProviders((d && d.providers) || []); })
    .catch(function(){});
}

function renderWearableProviders(list) {
  var el = document.getElementById('wearableProvidersGrid');
  if (!el) return;
  var envHints = {
    strava:   { vars: 'STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_WEBHOOK_VERIFY_TOKEN', url: 'https://www.strava.com/settings/api' },
    fitbit:   { vars: 'FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET',   url: 'https://dev.fitbit.com/apps/new' },
    polar:    { vars: 'POLAR_CLIENT_ID, POLAR_CLIENT_SECRET',     url: 'https://admin.polaraccesslink.com/' },
    withings: { vars: 'WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET', url: 'https://developer.withings.com/dashboard' },
    garmin:   { vars: 'GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET (approval required)', url: 'https://developerportal.garmin.com/user/me/apps' },
  };
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' +
      list.map(function(p){
        var hint = envHints[p.name] || { vars: '(see adapter file)', url: '#' };
        var statusColor = p.enabled ? '#A8FF00' : '#666';
        return (
          '<div style="border:1px solid ' + (p.enabled ? 'rgba(168,255,0,.32)' : '#2a2a2a') + ';border-radius:10px;padding:16px;background:' + (p.enabled ? 'rgba(168,255,0,.05)' : 'transparent') + '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
              '<div style="font-family:var(--ff-display,sans-serif);font-size:16px;font-weight:800;text-transform:uppercase">' + _escW(p.displayName) + '</div>' +
              '<span style="font-size:10px;color:' + statusColor + ';font-weight:700;text-transform:uppercase;letter-spacing:.08em">' + (p.enabled ? '● Live' : '○ Disabled') + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:#888;line-height:1.6;margin-bottom:10px">Env vars: <code style="background:#0f0f0f;color:#A8FF00;padding:2px 6px;border-radius:3px;font-size:10px">' + _escW(hint.vars) + '</code></div>' +
            '<a href="' + _escW(hint.url) + '" target="_blank" style="font-size:11px;color:#A8FF00;text-decoration:none">' + (p.enabled ? 'Manage in provider console →' : 'Get credentials →') + '</a>' +
          '</div>'
        );
      }).join('') +
    '</div>';
}

// ── Sync log ───────────────────────────────────────────────────
function loadWearableSyncLog() {
  fetch(ATP_API + '/wearables/admin/sync-log', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){ renderWearableSyncLog((d && d.log) || []); })
    .catch(function(){});
}

function renderWearableSyncLog(list) {
  var el = document.getElementById('wearableSyncLogList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:30px;color:#555;text-align:center;font-size:13px">No sync events yet.</div>';
    return;
  }
  el.innerHTML =
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="text-align:left;color:#888;border-bottom:1px solid #2a2a2a">' +
        '<th style="padding:8px 10px">Time</th>' +
        '<th style="padding:8px 10px">Member</th>' +
        '<th style="padding:8px 10px">Provider</th>' +
        '<th style="padding:8px 10px">Kind</th>' +
        '<th style="padding:8px 10px">Status</th>' +
        '<th style="padding:8px 10px">Counts</th>' +
        '<th style="padding:8px 10px">Detail</th>' +
      '</tr></thead><tbody>' +
      list.map(function(r){
        var statusColor = r.status === 'ok' ? '#A8FF00' : '#f87171';
        return (
          '<tr style="border-bottom:1px solid #1a1a1a">' +
            '<td style="padding:10px;color:#888;white-space:nowrap">' + new Date(r.created_at).toLocaleString() + '</td>' +
            '<td style="padding:10px;color:#fff">' + _escW((r.first_name || '') + ' ' + (r.last_name || '')) + '</td>' +
            '<td style="padding:10px;color:#ccc;text-transform:capitalize">' + _escW(r.provider) + '</td>' +
            '<td style="padding:10px;color:#888">' + _escW(r.kind) + '</td>' +
            '<td style="padding:10px;color:' + statusColor + ';font-weight:600">' + _escW(r.status) + '</td>' +
            '<td style="padding:10px;color:#888;font-size:11px">' + (r.workouts_added ? r.workouts_added + 'w ' : '') + (r.metrics_added ? r.metrics_added + 'm' : '') + '</td>' +
            '<td style="padding:10px;color:#888;font-size:11px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _escW(r.detail || '') + '">' + _escW(r.detail || '') + '</td>' +
          '</tr>'
        );
      }).join('') +
    '</tbody></table></div>';
}

function _escW(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
