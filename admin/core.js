/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Core: API helpers + auth + navigation + data globals
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
 * ATP Admin Panel — main script
 * Extracted from admin.html (Phase 3a: cacheable + searchable JS).
 * Future module splits can carve sections out into admin/*.js.
 * ════════════════════════════════════════════════════════════════ */

// ── Global API helpers ────────────────────────────────────────
var ATP_API = 'https://atpworldweb-production.up.railway.app/api';
function getToken() { return localStorage.getItem('atp_token') || ''; }
function apiGet(path) {
  return fetch(ATP_API + path, {
    headers: { 'Authorization': 'Bearer ' + getToken() }
  }).then(function(r) { return r.json(); });
}
function apiPost(path, body) {
  return fetch(ATP_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(body)
  }).then(function(r) { return r.json(); });
}
// ─────────────────────────────────────────────────────────────

// ── AUTH ─────────────────────────────────────────────────────
var ADMIN_CREDENTIALS = { user: 'atpadmin', pass: 'atp2015!' };
var adminLoggedIn = false;

function adminLogin() {
  var u = document.getElementById('adminUser').value.trim();
  var p = document.getElementById('adminPass').value;
  var errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';
  if (!u || !p) { errEl.textContent = 'Please enter email and password'; errEl.style.display = 'block'; return; }
  fetch('https://atpworldweb-production.up.railway.app/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: u, password: p})
  }).then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.token && data.member && data.member.is_admin) {
      localStorage.setItem('atp_token', data.token);
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminWrap').style.display = 'block';
      var LOGO = '/atp-logo-transparent.png';
      document.querySelectorAll('#adminLogo,#adminLogoNav').forEach(function(img) { img.src = LOGO; img.style.filter = 'none'; });
      loadDashboardAPI();
      loadMembersAPI();
      loadCities();
      loadCoaches(); loadTribes();
      loadDashboardWidgets && loadDashboardWidgets();
    } else if (data.token && data.member && !data.member.is_admin) {
      errEl.textContent = 'Account found but does not have admin access.';
      errEl.style.display = 'block';
    } else {
      errEl.textContent = data.error || 'Invalid email or password.';
      errEl.style.display = 'block';
    }
  }).catch(function() {
    errEl.textContent = 'Connection error — please try again.';
    errEl.style.display = 'block';
  });
}


function adminLogout() {
  adminLoggedIn = false;
  document.getElementById('adminWrap').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminUser').value = '';
  document.getElementById('adminPass').value = '';
}

document.getElementById('adminPass').addEventListener('keydown', function(e){
  if(e.key==='Enter') adminLogin();
});

// ── NAVIGATION ────────────────────────────────────────────────
function showAdminSection(name, btn) {
  if (name === 'sessions') { loadCities(); loadCoaches(); loadTribes(); setTimeout(loadSessionsList, 300); }
  // List MUST include every section id used in admin.html. Missing one
  // means that section never gets hidden, so navigating away leaves it
  // visible underneath the new section. 'settings' was added in Theme
  // 5b and was missing from this list — fixed here.
  ['dashboard','members','ambassadors','sessions','challenges','coaches','analytics','content','settings'].forEach(function(s){
    var el = document.getElementById('section-'+s);
    if (el) el.style.display = 'none';
  });
  var target = document.getElementById('section-'+name);
  if (target) target.style.display = 'block';
  else { console.warn('[admin] unknown section:', name); return; }
  document.querySelectorAll('.admin-nav-item').forEach(function(b){b.classList.remove('active');});
  if (btn) btn.classList.add('active');
  else {
    document.querySelectorAll('.admin-nav-item').forEach(function(b){
      if(b.textContent.toLowerCase().includes(name)) b.classList.add('active');
    });
  }
  // Auto-load real data when switching sections
  if (name === 'members') loadMembersAPI();
  if (name === 'ambassadors') loadAmbassadorsAPI();
  if (name === 'dashboard') { loadDashboardAPI(); loadDashboardWidgets && loadDashboardWidgets(); }
}

// ── DATA ──────────────────────────────────────────────────────
var MEMBERS_DATA = []; // Populated from API

var CHALLENGES_DATA = [
  {icon:'🏃',name:'July Run Challenge',type:'monthly',metric:'Sessions attended',target:8,desc:'Complete 8 running sessions this month',active:true,participants:127},
  {icon:'🔥',name:'Bootcamp Blitz',    type:'weekly', metric:'Sessions attended',target:4,desc:'Attend 4 bootcamp sessions in 2 weeks', active:true,participants:89},
];

