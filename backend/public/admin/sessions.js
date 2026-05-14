/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Sessions: list, create, edit, cancel, registrations
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ── SESSIONS ──────────────────────────────────────────────────
async function loadCities() {
  // Fetch cities from DB via members endpoint (cities are embedded in sessions)
  // Use a hardcoded list + dynamically add from DB
  var sel = document.getElementById('sCity');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select city...</option>';

  // Try to get from API
  try {
    var token = getToken();
    var data = await fetch('/api/sessions?limit=1', {
      headers: {'Authorization':'Bearer '+token}
    }).then(function(r){return r.json();});

    // Use known cities + any from sessions
    var cities = ['Dubai', 'Al Ain', 'Muscat'];
    cities.forEach(function(c) {
      var o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    });
  } catch(e) {
    ['Dubai','Al Ain','Muscat'].forEach(function(c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  }

  // Set default date to tomorrow at 7pm
  var dt = document.getElementById('sDate');
  if (dt) {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
    var pad = function(n){ return n < 10 ? '0'+n : n; };
    dt.value = d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
  }
}

function toggleLive() {
  var cb = document.getElementById('sLiveEnabled');
  var toggle = document.getElementById('sLiveToggle');
  var knob = document.getElementById('sLiveKnob');
  cb.checked = !cb.checked;
  if (cb.checked) {
    toggle.style.background = '#7AC231';
    toggle.style.borderColor = '#7AC231';
    knob.style.left = '22px';
    knob.style.background = '#fff';
  } else {
    toggle.style.background = '#1a1a1a';
    toggle.style.borderColor = '#333';
    knob.style.left = '2px';
    knob.style.background = '#444';
  }
}

// ═══════════════════════════════════════════════════════════
// SESSIONS MODULE
// ═══════════════════════════════════════════════════════════

var ALL_CITIES = [];
var SESSIONS_CACHE = {};
var SESSION_EDIT_ID = null;

var SPORT_LEVELS = {
  padel:      ['Beginner','Level D+','Level C-','Level C+','Level B'],
  football:   ['Beginner','Intermediate','Advanced'],
  volleyball: ['Beginner','Intermediate','Advanced'],
  badminton:  ['Beginner','Intermediate','Advanced'],
  basketball: ['Beginner','Intermediate','Advanced'],
};

function selectCategory(cat) {
  document.querySelectorAll('.session-cat-btn').forEach(function(b){ b.classList.remove('active'); });
  document.querySelector('[data-cat="'+cat+'"]').classList.add('active');
  document.getElementById('teamSportsSection').style.display = cat === 'team_sports' ? 'block' : 'none';
  if (cat === 'team_sports') buildCourtsUI();
}

function updateDayTimes() {
  var container = document.getElementById('dayTimesContainer');
  var checked = Array.from(document.querySelectorAll('.day-check-btn input:checked')).map(function(i){ return i.value; });
  container.innerHTML = checked.map(function(day) {
    return '<div style="display:flex;align-items:center;gap:8px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:8px 12px">' +
      '<span style="font-size:12px;font-weight:700;color:#7AC231;min-width:32px">'+day+'</span>' +
      '<input class="admin-form-input" type="time" id="time-'+day+'" value="06:30" style="width:90px;padding:4px 8px" title="Start time">' +
      '<span style="font-size:11px;color:#666">to</span>' +
      '<input class="admin-form-input" type="time" id="endtime-'+day+'" value="07:30" style="width:90px;padding:4px 8px" title="End time">' +
      '</div>';
  }).join('');
}

// ── Session intro-video upload (hover preview on /sessions cards) ──
// Reuses /api/cms/upload (already returns short /api/cms/media/<id> refs
// and stores the binary so it survives a refresh). Just drops the
// returned URL into the form field — saving the session persists it.
function pickSessionIntroVideo() {
  var input = document.getElementById('sIntroVideoFile');
  if (input) { input.value = ''; input.click(); }
}
function handleSessionIntroUpload(input) {
  var f = input && input.files && input.files[0];
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) {
    if (typeof showToast === 'function') showToast('❌ Video too large (max 10MB).', true);
    return;
  }
  var token = (typeof getToken === 'function') ? getToken() : (localStorage.getItem('atp_token') || '');
  var urlField = document.getElementById('sIntroVideo');
  if (urlField) urlField.value = 'Uploading…';
  var reader = new FileReader();
  reader.onload = function() {
    fetch(ATP_API + '/cms/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        data_url: reader.result,
        filename: f.name,
        kind: 'video',
      }),
    }).then(function(r){ return r.json().then(function(b){ return { ok: r.ok, body: b }; }); })
      .then(function(res){
        if (!res.ok || !res.body || !res.body.success) {
          if (urlField) urlField.value = '';
          if (typeof showToast === 'function') showToast('❌ ' + ((res.body && res.body.error) || 'Upload failed'), true);
          return;
        }
        if (urlField) urlField.value = res.body.url; // /api/cms/media/<id>
        if (typeof showToast === 'function') showToast('✅ Preview video uploaded — Save Session to apply');
      })
      .catch(function(e){
        if (urlField) urlField.value = '';
        if (typeof showToast === 'function') showToast('❌ ' + e.message, true);
      });
  };
  reader.readAsDataURL(f);
}

// Convert "HH:MM" pair to a positive minute delta. Crosses midnight if end < start.
function _minutesBetween(start, end) {
  if (!start || !end) return 0;
  var s = start.split(':'); var e = end.split(':');
  var mins = (parseInt(e[0],10)*60 + parseInt(e[1],10)) - (parseInt(s[0],10)*60 + parseInt(s[1],10));
  if (mins < 0) mins += 24 * 60;
  return mins;
}

function filterCitiesByCountry() {
  var country = document.getElementById('sCountry').value;
  var cityEl = document.getElementById('sCity');
  cityEl.innerHTML = '<option value="">Select City</option>';
  var filtered = ALL_CITIES.filter(function(c){ return !country || c.country === country; });
  // Deduplicate by name - keep first occurrence
  var seen = {};
  filtered = filtered.filter(function(c){ if(seen[c.name]) return false; seen[c.name]=true; return true; });
  filtered.forEach(function(c){
    cityEl.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
  });
  // Also update filter dropdown
  var filterEl = document.getElementById('filterCity');
  if (filterEl) {
    filterEl.innerHTML = '<option value="">All Cities</option>';
    ALL_CITIES.forEach(function(c){
      filterEl.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
    });
  }
}

async function loadCities() {
  try {
    var data = await apiGet('/cities');
    ALL_CITIES = data.cities || [];
    filterCitiesByCountry();
  } catch(e) { console.warn('Cities load error:', e.message); }
}

async function loadCoaches() {
  try {
    // Only members explicitly flagged as coaches populate the session coach dropdown
    var data = await apiGet('/admin/members?is_coach=true&limit=200');
    var coachEl = document.getElementById('sCoach');
    if (!coachEl) return;
    coachEl.innerHTML = '<option value="">No coach assigned</option>';
    (data.members || []).forEach(function(m){
      coachEl.innerHTML += '<option value="'+m.id+'">'+m.first_name+' '+m.last_name+'</option>';
    });
  } catch(e) { console.warn('Coaches load error:', e.message); }
}

// Ambassadors picker for the session form. Loaded once per page session
// since the roster changes rarely. Used by the "Nominated ambassadors"
// multi-select that only shows when "Allow this session to be streamed
// live" is on.
var ALL_AMBASSADORS = [];
var SESSION_AMBS_PICK = []; // mirror of currently picked ambassador ids
async function loadAmbassadorsForSession() {
  try {
    var data = await apiGet('/admin/members?is_ambassador=true&limit=500');
    ALL_AMBASSADORS = (data.members || []).slice();
    renderAmbassadorPicker();
  } catch(e) { console.warn('Ambassadors load error:', e.message); }
}
function renderAmbassadorPicker() {
  var sel = document.getElementById('sAmbassadorPicker');
  if (!sel) return;
  var pickedSet = new Set(SESSION_AMBS_PICK);
  sel.innerHTML = '<option value="">— Add ambassador —</option>' +
    ALL_AMBASSADORS
      .filter(function(m){ return !pickedSet.has(m.id); })
      .map(function(m){
        return '<option value="' + m.id + '">' + (m.first_name||'') + ' ' + (m.last_name||'') + (m.email ? ' · ' + m.email : '') + '</option>';
      }).join('');
  renderAmbassadorChips();
}
function renderAmbassadorChips() {
  var wrap = document.getElementById('sAmbassadorChips');
  if (!wrap) return;
  if (!SESSION_AMBS_PICK.length) {
    wrap.innerHTML = '<div style="font-size:11px;color:#666;padding:4px 0">No ambassadors nominated yet — the coach can still go live.</div>';
    return;
  }
  wrap.innerHTML = SESSION_AMBS_PICK.map(function(id){
    var m = ALL_AMBASSADORS.find(function(x){ return x.id === id; }) || { first_name:'Ambassador', last_name:'' };
    var name = ((m.first_name||'') + ' ' + (m.last_name||'')).trim() || 'Ambassador';
    return '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;font-size:12px;background:rgba(122,194,49,.12);color:#7AC231;border:1px solid rgba(122,194,49,.3);border-radius:20px">' +
      name.replace(/</g,'&lt;') +
      '<button type="button" onclick="removeSessionAmbassador(\'' + id + '\')" style="background:none;border:none;color:#7AC231;cursor:pointer;font-size:14px;line-height:1;padding:0">×</button>' +
    '</span>';
  }).join('');
}
function addSessionAmbassador(id) {
  if (!id) return;
  if (SESSION_AMBS_PICK.indexOf(id) >= 0) return;
  SESSION_AMBS_PICK.push(id);
  renderAmbassadorPicker();
}
function removeSessionAmbassador(id) {
  SESSION_AMBS_PICK = SESSION_AMBS_PICK.filter(function(x){ return x !== id; });
  renderAmbassadorPicker();
}
// Wire the picker change once on first run.
(function bindAmbassadorPicker() {
  document.addEventListener('change', function(ev){
    if (ev.target && ev.target.id === 'sAmbassadorPicker') {
      var v = ev.target.value;
      if (v) { addSessionAmbassador(v); ev.target.value = ''; }
    }
    if (ev.target && ev.target.id === 'sIsStreamable') {
      var det = document.getElementById('sStreamingDetails');
      if (det) det.style.display = ev.target.checked ? '' : 'none';
    }
  });
})();

async function loadTribes() {
  try {
    var res = await fetch(ATP_API + '/sessions/tribes');
    var data = await res.json();
    var tribeEl = document.getElementById('sTribe');
    if (!tribeEl) return;
    tribeEl.innerHTML = '<option value="">No tribe</option>';
    (data.tribes || []).forEach(function(t){
      tribeEl.innerHTML += '<option value="'+t.id+'">'+t.name+' Tribe</option>';
    });
  } catch(e) { console.warn('Tribes load error:', e.message); }
}

// Activity catalogue cached per page-load. The session form's "Activity"
// select is populated on demand based on the chosen tribe.
var SESSION_ACTIVITIES_CACHE = null;
async function loadActivitiesForSession() {
  try {
    var res  = await fetch(ATP_API + '/activities');
    var data = await res.json();
    SESSION_ACTIVITIES_CACHE = (data && data.activities) || [];
    filterActivitiesByTribe(); // initial render uses currently selected tribe (or all)
  } catch(e) { console.warn('Activities load error:', e.message); SESSION_ACTIVITIES_CACHE = []; }
}

// Cascading filter: when tribe changes, narrow the Activity dropdown to
// activities tagged with that tribe. "No tribe" shows the full catalogue
// so admins can still pick a tribe-less activity. Preserves the current
// activity selection if it still matches.
function filterActivitiesByTribe() {
  var tribeSel = document.getElementById('sTribe');
  var actSel   = document.getElementById('sActivity');
  if (!actSel) return;
  if (!SESSION_ACTIVITIES_CACHE) {
    actSel.innerHTML = '<option value="">Loading activities…</option>';
    return;
  }
  var tribeId = tribeSel ? tribeSel.value : '';
  var keep    = actSel.value;
  var list    = SESSION_ACTIVITIES_CACHE.filter(function(a){
    return tribeId ? (a.tribe_id === tribeId) : true;
  });
  if (!list.length) {
    actSel.innerHTML = '<option value="">' + (tribeId ? 'No activities for this tribe yet' : 'No activities defined') + '</option>';
    return;
  }
  actSel.innerHTML = '<option value="">— Select activity —</option>' +
    list.map(function(a){
      var icon = a.icon ? a.icon + ' ' : '';
      return '<option value="' + a.id + '">' + icon + (a.name || '').replace(/</g,'&lt;') + '</option>';
    }).join('');
  // Restore selection if it still belongs to the visible list
  if (keep && list.some(function(a){ return a.id === keep; })) actSel.value = keep;
}

function updateSportLevels() {
  buildCourtsUI();
}

function buildCourtsUI() {
  var sport = document.getElementById('sSport').value;
  var numCourts = parseInt(document.getElementById('sNumCourts').value) || 1;
  var levels = SPORT_LEVELS[sport] || ['Beginner','Intermediate','Advanced'];
  var container = document.getElementById('courtsContainer');
  container.innerHTML = '';
  for (var i = 1; i <= numCourts; i++) {
    var levOpts = levels.map(function(l){ return '<option value="'+l+'">'+l+'</option>'; }).join('');
    container.innerHTML += '<div class="court-card">' +
      '<div class="court-card-header">Court '+ i +'</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<div class="admin-form-group" style="flex:1;min-width:150px">' +
          '<label class="admin-form-label">Court Name</label>' +
          '<input class="admin-form-input" type="text" id="court-name-'+i+'" placeholder="e.g. Court '+i+'" value="Court '+i+'">' +
        '</div>' +
        '<div class="admin-form-group" style="flex:1;min-width:150px">' +
          '<label class="admin-form-label">Level Allowed</label>' +
          '<select class="admin-form-select" id="court-level-'+i+'">'+levOpts+'</select>' +
        '</div>' +
        '<div class="admin-form-group" style="flex:1;min-width:120px">' +
          '<label class="admin-form-label">Players per Court</label>' +
          '<input class="admin-form-input" type="number" id="court-players-'+i+'" value="4" min="2" max="20">' +
        '</div>' +
      '</div>' +
    '</div>';
  }
}

function getCourtsData() {
  var sport = document.getElementById('sSport').value;
  var numCourts = parseInt(document.getElementById('sNumCourts').value) || 1;
  var courts = [];
  for (var i = 1; i <= numCourts; i++) {
    courts.push({
      court_number: i,
      name: (document.getElementById('court-name-'+i) || {}).value || ('Court '+i),
      level: (document.getElementById('court-level-'+i) || {}).value || 'Beginner',
      max_players: parseInt((document.getElementById('court-players-'+i) || {}).value) || 4,
    });
  }
  return courts;
}

function buildRepeatDates(days, startDate, endDate, times) {
  if (!days.length || !startDate) return null;
  var dayMap = {Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:0};
  var dates = [];
  var start = new Date(startDate);
  var end = endDate ? new Date(endDate) : new Date(startDate);
  // If no end date, just get next occurrence of each selected day
  if (!endDate) {
    days.forEach(function(day) {
      var d = new Date(start);
      var target = dayMap[day];
      var diff = (target - d.getDay() + 7) % 7;
      if (diff === 0) diff = 0;
      d.setDate(d.getDate() + diff);
      var time = times[day] || '06:30';
      d.setHours(parseInt(time.split(':')[0]), parseInt(time.split(':')[1]), 0, 0);
      dates.push(d.toISOString());
    });
  } else {
    // Iterate from start to end date
    var current = new Date(start);
    while (current <= end) {
      var dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][current.getDay()];
      if (days.indexOf(dayName) !== -1) {
        var d = new Date(current);
        var time = times[dayName] || '06:30';
        d.setHours(parseInt(time.split(':')[0]), parseInt(time.split(':')[1]), 0, 0);
        dates.push(d.toISOString());
      }
      current.setDate(current.getDate() + 1);
    }
  }
  return dates;
}

function editSessionById(id) {
  var s = SESSIONS_CACHE[id];
  if (s) editSession(s);
}

// Pre-fill the create form from an existing session — same name, description,
// coach, tribe, activity, location, capacity, etc. — so the admin only has
// to pick new days/times. Stays in CREATE mode (SESSION_EDIT_ID = null) so
// hitting Save spawns a brand-new session row instead of overwriting the
// original.
function duplicateSessionById(id) {
  var s = SESSIONS_CACHE[id];
  if (!s) return;
  resetSessionForm();
  // Title hint
  var nameEl = document.getElementById('sName');
  if (nameEl) nameEl.value = (s.name || '') + ' (copy)';
  // Common fields
  var setVal = function(elId, v){ var el = document.getElementById(elId); if (el) el.value = v == null ? '' : v; };
  setVal('sDesc',     s.description);
  setVal('sLoc',      s.location);
  setVal('sMaps',     s.location_maps_url);
  setVal('sDuration', s.duration_mins || 60);
  setVal('sCap',      s.capacity || 30);
  setVal('sPoints',   s.points_reward || 10);
  setVal('sType',     s.session_type || 'free');
  if (document.getElementById('sPrice'))       document.getElementById('sPrice').value       = (s.price && Number(s.price) > 0) ? Number(s.price).toFixed(2) : '';
  if (document.getElementById('sPricePoints')) document.getElementById('sPricePoints').value = s.price_points || '';
  if (document.getElementById('sCurrency'))    document.getElementById('sCurrency').value    = s.currency_code || 'AED';
  if (s.coach_id) document.getElementById('sCoach').value = s.coach_id;
  if (s.tribe_id) document.getElementById('sTribe').value = s.tribe_id;
  var introEl = document.getElementById('sIntroVideo');
  if (introEl) introEl.value = s.intro_video_url || '';
  // Activity (cascading on tribe — defer so the dropdown is populated first)
  setTimeout(function(){
    if (typeof filterActivitiesByTribe === 'function') filterActivitiesByTribe();
    var actEl = document.getElementById('sActivity');
    if (actEl && s.activity_id) actEl.value = s.activity_id;
  }, 50);
  // City / country
  var cityObj = (typeof ALL_CITIES !== 'undefined' ? ALL_CITIES : []).find(function(c){ return c.id === s.city_id; });
  if (cityObj) {
    document.getElementById('sCountry').value = cityObj.country || 'UAE';
    if (typeof filterCitiesByCountry === 'function') filterCitiesByCountry();
    document.getElementById('sCity').value = s.city_id;
  }
  if (typeof selectCategory === 'function') selectCategory(s.session_category || 'regular');
  if (s.sport_type) { var sp = document.getElementById('sSport'); if (sp) sp.value = s.sport_type; }
  if (s.courts) {
    var nc = document.getElementById('sNumCourts'); if (nc) nc.value = s.courts.length;
    if (typeof buildCourtsUI === 'function') buildCourtsUI();
  }
  // Title + UI cues so the admin knows they're starting a fresh row, not editing
  var fTitle = document.getElementById('sessionFormTitle');
  if (fTitle) fTitle.textContent = 'Duplicate Session — pick new days & times';
  var subBtn = document.getElementById('sessionSubmitLabel');
  if (subBtn) subBtn.textContent = '✓ Create copy';
  var section = document.getElementById('sessionFormSection');
  if (section) section.scrollIntoView({behavior:'smooth'});
  if (typeof showToast === 'function') showToast('📋 Duplicated — set days & times for the new session');
}


async function cancelSessionById(id) {
  var s = SESSIONS_CACHE[id];
  if (!s) return;
  if (!confirm('Cancel "' + s.name + '"? All registered members will be notified.')) return;
  var reason = prompt('Reason (optional):', 'Session cancelled by admin') || '';
  try {
    var token = getToken();
    var res = await fetch(ATP_API + '/sessions/' + id + '/cancel', {
      method:'PATCH', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({reason})
    });
    var d = await res.json();
    if (d.session) { showToast('✅ Session cancelled'); loadSessionsList(); }
    else showToast('❌ '+(d.error||'Failed'), true);
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function cancelSeriesByName() {
  var s = prompt('Enter exact session name to cancel ALL upcoming occurrences:');
  if (!s) return;
  if (!confirm('This will cancel ALL future "' + s + '" sessions. Continue?')) return;
  var reason = prompt('Reason:') || 'Series cancelled by admin';
  try {
    var token = getToken();
    var res = await fetch(ATP_API + '/sessions/series/cancel', {
      method:'PATCH', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({name: s, reason})
    });
    var d = await res.json();
    showToast('✅ Cancelled '+(d.cancelled||0)+' sessions');
    loadSessionsList();
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function createSession() {
  var msgEl = document.getElementById('sessionFormMsg');
  var isEdit = !!SESSION_EDIT_ID;

  var name      = document.getElementById('sName').value.trim();
  var city_id   = document.getElementById('sCity').value;
  var location  = document.getElementById('sLoc').value.trim();
  var duration  = parseInt(document.getElementById('sDuration').value) || 60;
  var capacity  = parseInt(document.getElementById('sCap').value) || 30;
  var points    = parseInt(document.getElementById('sPoints').value) || 10;
  var stype     = document.getElementById('sType').value;
  // Paid-session pricing — admin can set EITHER points OR currency OR
  // both. Backend determines payment options shown to the member.
  var price_currency_str = (document.getElementById('sPrice') || {}).value;
  var price_points_str   = (document.getElementById('sPricePoints') || {}).value;
  var price_currency = price_currency_str ? Number(price_currency_str) : 0;
  var price_points   = price_points_str ? parseInt(price_points_str, 10) : 0;
  var currency_code  = (document.getElementById('sCurrency') || {}).value || 'AED';
  var desc      = document.getElementById('sDesc').value.trim();
  var maps      = document.getElementById('sMaps').value.trim();
  var live      = document.getElementById('sLiveEnabled').checked;
  var coach_id    = document.getElementById('sCoach').value || null;
  var tribe_id    = document.getElementById('sTribe').value || null;
  var activity_id = (document.getElementById('sActivity') || {}).value || null;
  var cat       = (document.querySelector('.session-cat-btn.active') || {}).dataset?.cat || 'regular';
  var sport     = document.getElementById('sSport').value || null;

  if (!name || !city_id || !location) {
    msgEl.textContent = '⚠️ Session Name, City and Location are required.';
    msgEl.style.cssText = 'display:block;background:#2a1010;color:#f87171;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:13px';
    return;
  }

  // Get selected days + times
  var days = Array.from(document.querySelectorAll('.day-check-btn input:checked')).map(function(i){ return i.value; });
  var startDate = document.getElementById('sStartDate').value;
  var endDate = document.getElementById('sEndDate').value;

  if (!days.length && !isEdit) {
    msgEl.textContent = '⚠️ Please select at least one day.';
    msgEl.style.cssText = 'display:block;background:#2a1010;color:#f87171;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:13px';
    return;
  }

  var times = {};
  var endTimes = {};
  days.forEach(function(day) {
    var sEl = document.getElementById('time-'+day);
    var eEl = document.getElementById('endtime-'+day);
    times[day]    = sEl ? sEl.value : '06:30';
    endTimes[day] = eEl ? eEl.value : '07:30';
  });

  // Derive duration from the first selected day's start/end pair. All days
  // in a recurring set share the same duration here; if you want per-day
  // durations later, the `endTimes` map already has them.
  var firstDay = days[0];
  if (firstDay) {
    var derived = _minutesBetween(times[firstDay], endTimes[firstDay]);
    if (derived > 0) duration = derived;
  }

  var repeat_dates = null;
  if (!isEdit) {
    repeat_dates = buildRepeatDates(days, startDate || new Date().toISOString().split('T')[0], endDate, times);
    if (!repeat_dates || !repeat_dates.length) {
      msgEl.textContent = '⚠️ Please set a start date and select at least one day.';
      msgEl.style.cssText = 'display:block;background:#2a1010;color:#f87171;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:13px';
      return;
    }
  }

  var courts = cat === 'team_sports' ? getCourtsData() : null;
  // CREATE: scheduled_at comes from the first day in the recurrence set.
  // EDIT: there's no date editor in the form (sEditDate doesn't exist), so
  // we leave scheduled_at undefined → omitted from the JSON body → server
  // COALESCE keeps the existing column value instead of nulling it.
  var scheduled_at = repeat_dates ? repeat_dates[0] : (document.getElementById('sEditDate')?.value || undefined);

  var intro_video_url = (document.getElementById('sIntroVideo') || {}).value || null;
  if (intro_video_url === 'Uploading…') intro_video_url = null;
  var is_streamable = !!(document.getElementById('sIsStreamable') || {}).checked;
  var assigned_ambassador_ids = is_streamable ? SESSION_AMBS_PICK.slice() : [];
  var payload = {
    name, tribe_id, activity_id, city_id, description: desc, coach_id, location,
    intro_video_url,
    location_maps_url: maps, session_type: stype, capacity,
    scheduled_at, duration_mins: duration, points_reward: points,
    is_live_enabled: live, session_category: cat,
    sport_type: sport, courts,
    // Paid-session pricing (Theme 11)
    price:          price_currency || 0,
    price_points:   price_points || 0,
    currency_code:  currency_code || 'AED',
    repeat_dates: repeat_dates && repeat_dates.length > 1 ? repeat_dates : null,
    // Live streaming wiring
    is_streamable: is_streamable,
    assigned_ambassador_ids: assigned_ambassador_ids,
  };

  var btnLabel = document.getElementById('sessionSubmitLabel');
  var origLabel = btnLabel.textContent;
  btnLabel.textContent = '⏳ Saving...';

  try {
    var token = getToken();
    var url = isEdit
      ? '/api/sessions/' + SESSION_EDIT_ID
      : '/api/sessions';
    var method = isEdit ? 'PUT' : 'POST';

    var res = await fetch(url, {
      method, headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify(payload)
    });
    var data = await res.json();

    if (data.sessions || data.session) {
      var count = data.sessions ? data.sessions.length : 1;
      msgEl.textContent = isEdit ? '✅ Session updated!' : '✅ '+count+' session(s) created!';
      msgEl.style.cssText = 'display:block;background:#0d1a0a;color:#7AC231;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:13px';
      resetSessionForm();
      setTimeout(function(){ loadSessionsList(); loadDashboardAPI(); }, 800);
    } else {
      throw new Error(data.error || 'Failed to save session');
    }
  } catch(e) {
    msgEl.textContent = '❌ '+e.message;
    msgEl.style.cssText = 'display:block;background:#2a1010;color:#f87171;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:13px';
  } finally {
    btnLabel.textContent = origLabel;
  }
}

function resetSessionForm() {
  SESSION_EDIT_ID = null;
  document.getElementById('sEditId').value = '';
  document.getElementById('sName').value = '';
  document.getElementById('sDesc').value = '';
  document.getElementById('sLoc').value = '';
  document.getElementById('sMaps').value = '';
  document.getElementById('sCity').value = '';
  document.getElementById('sCountry').value = '';
  document.getElementById('sStartDate').value = '';
  document.getElementById('sEndDate').value = '';
  if (document.getElementById('sPrice'))       document.getElementById('sPrice').value = '';
  if (document.getElementById('sPricePoints')) document.getElementById('sPricePoints').value = '';
  if (document.getElementById('sCurrency'))    document.getElementById('sCurrency').value = 'AED';
  document.querySelectorAll('.day-check-btn input').forEach(function(cb){ cb.checked = false; });
  document.getElementById('dayTimesContainer').innerHTML = '';
  selectCategory('regular');
  // Reset live-streaming controls.
  var st = document.getElementById('sIsStreamable'); if (st) st.checked = false;
  var det = document.getElementById('sStreamingDetails'); if (det) det.style.display = 'none';
  SESSION_AMBS_PICK = [];
  if (typeof renderAmbassadorPicker === 'function') renderAmbassadorPicker();
  document.getElementById('sessionFormTitle').textContent = 'Create New Session';
  document.getElementById('sessionSubmitLabel').textContent = '＋ Create Session';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

function cancelEditSession() { resetSessionForm(); }

function editSession(s) {
  SESSION_EDIT_ID = s.id;
  document.getElementById('sName').value = s.name || '';
  document.getElementById('sDesc').value = s.description || '';
  document.getElementById('sLoc').value = s.location || '';
  document.getElementById('sMaps').value = s.location_maps_url || '';
  document.getElementById('sDuration').value = s.duration_mins || 60;
  document.getElementById('sCap').value = s.capacity || 30;
  document.getElementById('sPoints').value = s.points_reward || 10;
  document.getElementById('sType').value = s.session_type || 'free';
  // Paid-session pricing — load existing values; the form fields are
  // optional in the markup so editing legacy sessions still works.
  if (document.getElementById('sPrice'))       document.getElementById('sPrice').value       = (s.price != null && s.price !== '0' && s.price !== 0) ? Number(s.price).toFixed(2) : '';
  if (document.getElementById('sPricePoints')) document.getElementById('sPricePoints').value = s.price_points || '';
  if (document.getElementById('sCurrency'))    document.getElementById('sCurrency').value    = s.currency_code || 'AED';
  if (s.coach_id) document.getElementById('sCoach').value = s.coach_id;
  if (s.tribe_id) document.getElementById('sTribe').value = s.tribe_id;
  var introEl = document.getElementById('sIntroVideo');
  if (introEl) introEl.value = s.intro_video_url || '';
  // Activity: re-filter the dropdown to the selected tribe, then pick the
  // saved activity. Wrapped in setTimeout so it runs after the activities
  // catalogue resolves on first edit-open.
  setTimeout(function(){
    if (typeof filterActivitiesByTribe === 'function') filterActivitiesByTribe();
    var actEl = document.getElementById('sActivity');
    if (actEl && s.activity_id) actEl.value = s.activity_id;
  }, 50);
  // Set city + country
  var cityObj = ALL_CITIES.find(function(c){ return c.id === s.city_id; });
  if (cityObj) {
    document.getElementById('sCountry').value = cityObj.country || 'UAE';
    filterCitiesByCountry();
    document.getElementById('sCity').value = s.city_id;
  }
  selectCategory(s.session_category || 'regular');
  if (s.sport_type) document.getElementById('sSport').value = s.sport_type;
  if (s.courts) {
    document.getElementById('sNumCourts').value = s.courts.length;
    buildCourtsUI();
  }
  // Live streaming prefill — the cached session row already carries
  // is_streamable when present; the assigned ambassadors come from a
  // dedicated GET (since they live in a join table).
  var stEl  = document.getElementById('sIsStreamable');
  var detEl = document.getElementById('sStreamingDetails');
  if (stEl) {
    stEl.checked = !!s.is_streamable;
    if (detEl) detEl.style.display = stEl.checked ? '' : 'none';
  }
  SESSION_AMBS_PICK = [];
  if (typeof renderAmbassadorPicker === 'function') renderAmbassadorPicker();
  if (s.id) {
    apiGet('/sessions/' + s.id).then(function(d){
      var amb = (d && d.assigned_ambassadors) || [];
      SESSION_AMBS_PICK = amb.map(function(a){ return a.ambassador_id; });
      renderAmbassadorPicker();
    }).catch(function(){});
  }

  document.getElementById('sessionFormTitle').textContent = 'Edit Session';
  document.getElementById('sessionSubmitLabel').textContent = '✓ Save Changes';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  document.getElementById('sessionFormSection').scrollIntoView({behavior:'smooth'});
}

async function loadSessionsList() {
  var tbody = document.getElementById('sessionsTbody');
  var countEl = document.getElementById('sessionsCountLabel');
  if (!tbody) return;

  var cityF = (document.getElementById('filterCity') || {}).value || '';
  var catF = (document.getElementById('filterCategory') || {}).value || '';
  var statusF = (document.getElementById('filterStatus') || {}).value || 'upcoming';
  var searchF = (document.getElementById('filterSearch') || {}).value || '';

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#444;padding:24px">Loading...</td></tr>';

  try {
    var params = 'limit=100';
    if (cityF) params += '&city_id='+cityF;
    if (statusF) params += '&status='+statusF;
    var data = await apiGet('/sessions?'+params);
    var sessions = (data.sessions || []);

    // Client-side filter for category + search
    if (catF) sessions = sessions.filter(function(s){ return s.session_category === catF; });
    if (searchF) {
      var q = searchF.toLowerCase();
      sessions = sessions.filter(function(s){ return (s.name||'').toLowerCase().includes(q) || (s.location||'').toLowerCase().includes(q); });
    }

    if (countEl) countEl.textContent = sessions.length + ' sessions';

    if (!sessions.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#444;padding:24px">No sessions found</td></tr>';
      return;
    }

    var catIcon = {regular:'🏃',social:'🎉',team_sports:'🏆'};
    var catLabel = {regular:'Regular',social:'Social',team_sports:'Team Sports'};

    tbody.innerHTML = sessions.forEach(function(s){ SESSIONS_CACHE[s.id]=s; });
    tbody.innerHTML = sessions.map(function(s) {
      var dt = s.scheduled_at ? new Date(s.scheduled_at) : null;
      var dateStr = dt ? dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' ' + dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '—';
      var cat = s.session_category || 'regular';
      var sportIcons = {padel:'🎾', football:'⚽', volleyball:'🏐', badminton:'🏸', basketball:'🏀'};
      var sportBadge = '';
      if (cat === 'team_sports' && s.sport_type) {
        var courtsArr = s.courts;
        if (typeof courtsArr === 'string') { try { courtsArr = JSON.parse(courtsArr); } catch(e){ courtsArr = []; } }
        var courtCount = Array.isArray(courtsArr) ? courtsArr.length : 0;
        sportBadge = '<div style="font-size:11px;color:#7AC231;margin-top:3px;font-weight:600">'+(sportIcons[s.sport_type]||'🏆')+' '+s.sport_type.charAt(0).toUpperCase()+s.sport_type.slice(1);
        if (courtCount) sportBadge += ' · '+courtCount+' court'+(courtCount>1?'s':'');
        sportBadge += '</div>';
      }
      var statusBadge = s.status === 'completed'
        ? '<span class="badge badge-grey">Completed</span>'
        : '<span class="badge badge-green">Upcoming</span>';
      return '<tr>' +
        '<td><div class="admin-member-name">'+s.name+'</div><div class="admin-member-email">'+(s.location||'')+'</div>'+sportBadge+'</td>' +
        '<td><span style="font-size:16px">'+catIcon[cat]+'</span> <span style="font-size:12px;color:#888">'+catLabel[cat]+'</span></td>' +
        '<td style="font-size:12px;color:#888">'+(s.city_name||'—')+'</td>' +
        '<td style="font-size:12px">'+dateStr+'</td>' +
        '<td style="font-size:13px">'+(s.checkins_count||0)+' / '+(s.capacity||'?')+'</td>' +
        '<td style="font-size:12px;color:#888">'+(s.coach_name||'—')+'</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="admin-btn" style="font-size:11px;padding:4px 8px;margin-right:3px" onclick="editSessionById(\'' + s.id + '\')" title="Edit">✏️</button>' +
          '<button class="admin-btn" style="font-size:11px;padding:4px 8px;margin-right:3px" onclick="duplicateSessionById(\'' + s.id + '\')" title="Duplicate session">📋</button>' +
          '<button class="admin-btn" style="font-size:11px;padding:4px 8px;margin-right:3px" onclick="viewRegistrations(\'' + s.id + '\')" title="Registrations">' +
          '👥 ' + (s.registrations_count || 0) +
          '</button>' +
          (s.status !== 'cancelled' ? '<button class="admin-btn" style="font-size:11px;padding:4px 8px;color:#f87171;border-color:#3a1a1a" onclick="cancelSession(\'' + s.id + '\',\'' + (s.name||'session').replace(/\'/g,'') + '\')" title="Cancel session">✕</button>' : '<span class="badge badge-grey">Cancelled</span>') +
        '</td>' +
        '</tr>';
    }).join('');

  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#f87171;padding:24px">Error: '+e.message+'</td></tr>';
  }
}

async function viewRegistrations(sessionId) {
  var s = SESSIONS_CACHE[sessionId] || {};
  var sessionName = s.name || 'Session';
  var modal = document.getElementById('registrationsModal');
  var body = document.getElementById('regModalBody');
  var title = document.getElementById('regModalTitle');
  title.textContent = '👥 ' + sessionName;
  modal.style.display = 'flex';
  body.innerHTML = '<div style="text-align:center;color:#444;padding:24px">Loading...</div>';

  try {
    var token = getToken();
    var res = await fetch('/api/sessions/'+sessionId+'/registrations', {
      headers:{'Authorization':'Bearer '+token}
    });
    var data = await res.json();
    var regs = data.registrations || [];
    if (!regs.length) {
      body.innerHTML = '<div style="text-align:center;color:#444;padding:24px">No registrations yet</div>';
      return;
    }
    var courtsSummary = '';
    var courtsArr = s ? s.courts : null;
    if (typeof courtsArr === 'string') { try { courtsArr = JSON.parse(courtsArr); } catch(e) { courtsArr = []; } }
    if (s && s.session_category === 'team_sports' && Array.isArray(courtsArr) && courtsArr.length) {
      var grouped = {};
      regs.forEach(function(r){
        var court = r.court_name || 'Unassigned';
        if (!grouped[court]) grouped[court] = 0;
        grouped[court]++;
      });
      courtsSummary = '<div style="background:#111;border-radius:10px;padding:12px;margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">';
      courtsArr.forEach(function(ct){
        var count = grouped[ct.name] || 0;
        var pct = Math.round((count/(ct.max_players||4))*100);
        courtsSummary += '<div style="padding:10px;background:#1a1a1a;border-radius:8px;border-left:3px solid #7AC231">'+
          '<div style="font-size:12px;font-weight:700;color:#fff">'+ct.name+'</div>'+
          '<div style="font-size:10px;color:#7AC231;margin-top:2px">'+ct.level+'</div>'+
          '<div style="font-size:14px;color:#fff;margin-top:6px;font-weight:700">'+count+' / '+ct.max_players+'</div>'+
          '<div style="height:3px;background:#2a2a2a;border-radius:2px;margin-top:4px"><div style="width:'+pct+'%;height:100%;background:#7AC231;border-radius:2px"></div></div>'+
        '</div>';
      });
      courtsSummary += '</div>';
    }
    body.innerHTML = courtsSummary + '<div style="font-size:12px;color:#888;margin-bottom:12px">'+regs.length+' registered</div>' +
      '<table class="admin-table" style="width:100%"><thead><tr><th>Member</th><th>Member #</th><th>Level</th><th>Court</th><th>Status</th></tr></thead><tbody>' +
      regs.map(function(r){
        return '<tr>'+
          '<td><div class="admin-member-name">'+r.first_name+' '+r.last_name+'</div><div class="admin-member-email">'+r.email+'</div></td>'+
          '<td style="font-size:12px;color:#888">'+r.member_number+'</td>'+
          '<td style="font-size:12px;color:#888">'+(r.padel_level||'—')+'</td>'+
          '<td style="font-size:12px;color:#7AC231">'+(r.court_name||'—')+'</td>'+
          '<td><span class="badge '+(r.status==='attended'?'badge-green':'badge-grey')+'">'+r.status+'</span></td>'+
          '</tr>';
      }).join('')+'</tbody></table>';
  } catch(e) {
    body.innerHTML = '<div style="text-align:center;color:#f87171;padding:24px">Error: '+e.message+'</div>';
  }
}

function closeRegistrations() {
  document.getElementById('registrationsModal').style.display = 'none';
}

async function setAmbassadorAPI(memberId, enabled) {
  if (!window.ATP || !window.ATP.isLoggedIn()) return;
  try {
    await window.ATP.admin.setAmbassador(memberId, enabled);
    console.log('Ambassador updated:', memberId, enabled);
  } catch(e) { console.warn('Ambassador API:', e.message); }
}


/* ──────────────────────────────────────────────────────────────────
 * (block boundary — was the second <script> tag in admin.html)
 * ────────────────────────────────────────────────────────────── */

var LOGO_SRC = "/atp-logo-transparent.png";
document.getElementById('adminLogo').src = LOGO_SRC;
document.getElementById('adminLogoNav').src = LOGO_SRC;


