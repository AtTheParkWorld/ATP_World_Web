/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Session-cancel utility + showAdminSection hook (loads last)
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// SESSION CANCEL
// ═══════════════════════════════════════════════════════════
async function cancelSession(sessionId, sessionName) {
  if (!confirm('Cancel "' + sessionName + '"? Members will be notified.')) return;
  var reason = prompt('Cancellation reason (optional):') || '';
  var token = getToken();
  try {
    var res = await fetch(ATP_API+'/sessions/'+sessionId+'/cancel', {
      method:'PATCH', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({reason})
    });
    var d = await res.json();
    if (d.session) { showToast('✅ Session cancelled'); loadSessionsList(); }
    else { showToast('❌ '+(d.error||'Failed'), true); }
  } catch(e) { showToast('❌ '+e.message, true); }
}

// ═══════════════════════════════════════════════════════════
// HOOK EVERYTHING INTO showAdminSection
// ═══════════════════════════════════════════════════════════
// Override showAdminSection to load data on tab switch
(function() {
  var _orig = window.showAdminSection;
  window.showAdminSection = function(name, btn) {
    if (_orig) _orig(name, btn);
    if (name === 'sessions')   { loadCities(); loadCoaches(); loadTribes(); setTimeout(loadSessionsList, 200); }
    if (name === 'challenges') { loadChallengesList(); populateChallengeCities(); regenerateBadge(); }
    if (name === 'coaches')    { loadCoachesSection(); }
    if (name === 'analytics')  {
      loadAnalytics();
      // Theme 12 — set default range + load v2 metrics on open
      try { setAnalyticsRange('12m'); } catch(e) {}
    }
    if (name === 'members')    { loadMembersAPI(); }
    if (name === 'ambassadors'){ renderAmbassadors(); }
    if (name === 'settings')   { loadSettingsSection(); }
  };
})();

async function populateChallengeCities() {
  var el = document.getElementById('cCity');
  if (!el || ALL_CITIES.length) {
    if (el && ALL_CITIES.length) {
      el.innerHTML = '<option value="">All Cities (Global)</option>';
      ALL_CITIES.forEach(function(c){ el.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>'; });
    }
    return;
  }
  await loadCities();
  el.innerHTML = '<option value="">All Cities (Global)</option>';
  ALL_CITIES.forEach(function(c){ el.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>'; });
}

// Add Cancel button to sessions table rows
var _origLoadSessionsList = window.loadSessionsList;
window.loadSessionsList = async function() {
  await _origLoadSessionsList();
  // Add cancel buttons to each row
  var rows = document.querySelectorAll('#sessionsTbody tr');
  // The rows already get edit + registrations — we hook cancel via editSession context
};

// Run badge on load
document.addEventListener('DOMContentLoaded', regenerateBadge);
setTimeout(regenerateBadge, 500);


