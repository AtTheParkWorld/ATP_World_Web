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
var ATP_API = '/api';
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
// Login is real — POSTs /api/auth/login below and checks the
// returned member.is_admin flag. The dead ADMIN_CREDENTIALS literal
// that used to live here was removed because it leaked a historical
// password format hint via View-Source even though the code never
// referenced it.
var adminLoggedIn = false;

function adminLogin() {
  var u = document.getElementById('adminUser').value.trim();
  var p = document.getElementById('adminPass').value;
  var errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';
  if (!u || !p) { errEl.textContent = 'Please enter email and password'; errEl.style.display = 'block'; return; }
  fetch('/api/auth/login', {
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
  // Clear the JWT token + any cached form drafts so the next login
  // starts clean. Without this, an expired token stays in localStorage
  // and every API call keeps failing with 'Token expired'.
  try {
    localStorage.removeItem('atp_token');
    localStorage.removeItem('atp_st_draft');
  } catch (e) {}
  adminLoggedIn = false;
  // Hard-reload to /admin so the page boots fresh with no stale state.
  location.href = '/admin';
}

document.getElementById('adminPass').addEventListener('keydown', function(e){
  if(e.key==='Enter') adminLogin();
});

// ── NAVIGATION ────────────────────────────────────────────────
function showAdminSection(name, btn) {
  if (name === 'sessions') { loadCities(); loadCoaches(); loadTribes(); if (typeof loadSessionTemplates === 'function') loadSessionTemplates(); setTimeout(loadSessionsList, 300); }
  // Hide EVERY section by id prefix — was a hardcoded list previously and
  // kept drifting (founder/surveys/corporate/partners/wearables were
  // missing as of v1.32.x, so all rendered on top of each other).
  // Querying by the shared id prefix keeps this self-maintaining.
  document.querySelectorAll('[id^="section-"]').forEach(function(el){
    el.style.display = 'none';
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

// ── GENERIC MEDIA UPLOAD HELPER ────────────────────────────────
// Rulebook ref: R-MED-005 (OQ-39). Direct-to-R2 (v1.61) with legacy
// base64 fallback. Wires a hidden <input type="file"> + a visible
// "📁 Upload" button to a URL text input.
//
// Flow per file:
//   1. POST /api/cms/upload-url  → signed PUT + the eventual public URL
//   2. PUT the file bytes directly to R2 via the signed URL
//   3. POST /api/cms/upload-complete → records cms_content row,
//                                      returns canonical public URL
// If /upload-url returns 503 R2_NOT_CONFIGURED, falls back to the
// legacy base64 POST /api/cms/upload path so admin uploads stay
// functional in any environment.
//
// HTML pattern (all three IDs explicit; no naming convention required):
//   <input id="myUrl" type="text">
//   <input id="myFile" type="file" accept="image/*" style="display:none"
//          onchange="atpUpload('myFile','myUrl','image',2)">
//   <button onclick="document.getElementById('myFile').click()">📁 Upload</button>
function atpUpload(fileInputId, urlFieldId, kind, maxMB) {
  var input = document.getElementById(fileInputId);
  var urlField = document.getElementById(urlFieldId);
  if (!input || !urlField) return;
  var f = input.files && input.files[0];
  if (!f) return;
  var limit = (maxMB || 5) * 1024 * 1024;
  if (f.size > limit) {
    if (typeof showToast === 'function') showToast('❌ File too large (max ' + (maxMB || 5) + 'MB).', true);
    input.value = '';
    return;
  }
  var token = (typeof getToken === 'function') ? getToken() : (localStorage.getItem('atp_token') || '');
  var auth  = { 'Authorization': 'Bearer ' + token };
  var prev  = urlField.value;
  urlField.value = 'Uploading…';

  async function tryR2() {
    var ct = f.type || 'image/jpeg';
    var step1 = await fetch(ATP_API + '/cms/upload-url', {
      method:  'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body:    JSON.stringify({ kind: kind || 'image', filename: f.name, content_type: ct }),
    });
    if (step1.status === 503) throw 'R2_NOT_CONFIGURED';
    var j1 = await step1.json();
    if (!step1.ok || !j1.upload_url) throw new Error((j1 && j1.error) || 'upload-url failed');

    var step2 = await fetch(j1.upload_url, {
      method:  'PUT',
      headers: { 'Content-Type': ct },
      body:    f,
    });
    if (!step2.ok) throw new Error('R2 upload failed (' + step2.status + ')');

    var step3 = await fetch(ATP_API + '/cms/upload-complete', {
      method:  'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body:    JSON.stringify({
        key:        j1.key,
        public_url: j1.public_url,
        kind:       kind || 'image',
        filename:   f.name,
        size_bytes: f.size,
      }),
    });
    var j3 = await step3.json();
    if (!step3.ok || !j3.url) throw new Error((j3 && j3.error) || 'upload-complete failed');
    return j3.url;
  }

  function tryLegacyBase64() {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        fetch(ATP_API + '/cms/upload', {
          method:  'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
          body:    JSON.stringify({ data_url: reader.result, filename: f.name, kind: kind || 'image' }),
        }).then(function(r){ return r.json().then(function(b){ return { ok: r.ok, body: b }; }); })
          .then(function(res){
            if (!res.ok || !res.body || !res.body.success) {
              return reject(new Error((res.body && res.body.error) || 'Upload failed'));
            }
            resolve(res.body.url);
          })
          .catch(reject);
      };
      reader.onerror = function(){ reject(new Error('File read failed')); };
      reader.readAsDataURL(f);
    });
  }

  Promise.resolve()
    .then(function(){ return tryR2(); })
    .catch(function(e){
      if (e === 'R2_NOT_CONFIGURED') {
        return tryLegacyBase64();
      }
      throw e;
    })
    .then(function(url){
      urlField.value = url;
      if (typeof showToast === 'function') showToast('✅ Uploaded — Save to apply');
    })
    .catch(function(e){
      urlField.value = prev;
      if (typeof showToast === 'function') showToast('❌ ' + (e.message || e), true);
    })
    .finally(function(){ input.value = ''; });
}

// ── DATA ──────────────────────────────────────────────────────
var MEMBERS_DATA = []; // Populated from API

var CHALLENGES_DATA = [
  {icon:'🏃',name:'July Run Challenge',type:'monthly',metric:'Sessions attended',target:8,desc:'Complete 8 running sessions this month',active:true,participants:127},
  {icon:'🔥',name:'Bootcamp Blitz',    type:'weekly', metric:'Sessions attended',target:4,desc:'Attend 4 bootcamp sessions in 2 weeks', active:true,participants:89},
];

