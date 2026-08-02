/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Corporate Wellness
 * Sprint 2 surface: leads pipeline CRM + accounts management + live
 * engagement metrics per account.
 * ════════════════════════════════════════════════════════════════ */

var CORP_VIEW = 'leads';        // 'leads' | 'accounts' | 'packages' | 'account_detail'
var CORP_ACTIVE_ID = null;
var CORP_ACTIVE_ACCOUNT = null; // cached account object when in detail view
var CORP_PACKAGES = [];         // cached catalogue (admin list, incl. inactive)

function loadCorporateSection() {
  renderCorporateSubtabs();
  showCorporateTab(CORP_VIEW);
}

function renderCorporateSubtabs() {
  var host = document.getElementById('corporateSubtabs');
  if (!host) return;
  var tabs = [
    { v: 'leads',    l: 'Leads pipeline' },
    { v: 'accounts', l: 'Active accounts' },
    { v: 'packages', l: '💎 Packages' },
  ];
  host.innerHTML = tabs.map(function(t){
    var on = CORP_VIEW === t.v;
    return '<button class="corp-subtab' + (on ? ' active' : '') + '" data-atp-call="showCorporateTab" data-args=\'["' + t.v + '"]\' style="padding:7px 14px;font-size:12px;font-weight:700;background:' + (on ? 'rgba(168,255,0,.12)' : 'transparent') + ';color:' + (on ? '#A8FF00' : '#888') + ';border:1px solid ' + (on ? 'rgba(168,255,0,.3)' : '#2a2a2a') + ';border-radius:8px;cursor:pointer">' + t.l + '</button>';
  }).join('');
}

function showCorporateTab(tab) {
  CORP_VIEW = tab;
  renderCorporateSubtabs();
  if (tab === 'leads') loadCorporateLeads();
  else if (tab === 'accounts') loadCorporateAccounts();
  else if (tab === 'packages') loadCorporatePackages();
  else if (tab === 'account_detail') loadCorporateAccountDetail(CORP_ACTIVE_ID);
}

// ── LEADS PIPELINE ─────────────────────────────────────────────
function loadCorporateLeads() {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading leads…</div>';
  fetch(ATP_API + '/corporate/admin/leads', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){ renderCorporateLeads((d && d.leads) || []); })
    .catch(function(){ host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed. Migration run?</div>'; });
}

function renderCorporateLeads(leads) {
  var host = document.getElementById('corporateBody');
  if (!host) return;

  var stages = ['new', 'qualified', 'pitch_sent', 'negotiating', 'won', 'lost'];
  var stageColors = { new:'#888', qualified:'#3b82f6', pitch_sent:'#f59e0b', negotiating:'#f5c042', won:'#A8FF00', lost:'#ef4444' };
  var byStage = {};
  stages.forEach(function(s){ byStage[s] = []; });
  leads.forEach(function(l){ if (byStage[l.stage]) byStage[l.stage].push(l); });

  var pipelineValue = leads.filter(function(l){ return ['qualified','pitch_sent','negotiating'].includes(l.stage); })
                          .reduce(function(s, l){ return s + (l.estimated_aed || 0); }, 0);
  var wonValue = leads.filter(function(l){ return l.stage === 'won'; }).reduce(function(s, l){ return s + (l.estimated_aed || 0); }, 0);

  var html =
    // Pipeline summary
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px">' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px"><div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Total leads</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#fff">' + leads.length + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid rgba(245,158,11,.32);border-radius:10px;padding:18px"><div style="font-size:10px;color:#f59e0b;letter-spacing:.12em;text-transform:uppercase;font-weight:600">In pipeline (AED MRR)</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#f59e0b">' + pipelineValue.toLocaleString() + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid rgba(168,255,0,.32);border-radius:10px;padding:18px"><div style="font-size:10px;color:#A8FF00;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Won (AED MRR)</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#A8FF00">' + wonValue.toLocaleString() + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px;display:flex;align-items:center;justify-content:center"><button class="admin-btn admin-btn-primary" data-atp-call="newCorporateLeadForm" style="font-size:13px;padding:10px 20px">+ Add lead</button></div>' +
    '</div>' +
    '<div id="corpLeadFormWrap"></div>' +
    // Kanban-style columns
    '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;overflow-x:auto">';

  stages.forEach(function(stage){
    var stageLeads = byStage[stage];
    html += '<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:10px;padding:12px;min-width:220px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1a1a1a">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + stageColors[stage] + '"></span>' +
        '<span style="font-size:10px;color:' + stageColors[stage] + ';font-weight:800;letter-spacing:.08em;text-transform:uppercase">' + stage.replace('_',' ') + '</span>' +
        '<span style="margin-left:auto;font-size:11px;color:#666">' + stageLeads.length + '</span>' +
      '</div>';
    if (!stageLeads.length) {
      html += '<div style="font-size:11px;color:#555;padding:14px 0;text-align:center">Empty</div>';
    } else {
      html += stageLeads.map(function(l){
        return '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:10px;margin-bottom:6px;cursor:pointer" data-atp-call="editCorporateLead" data-args=\'["' + l.id + '"]\'>' +
          '<div style="font-size:12px;color:#fff;font-weight:700;margin-bottom:4px">' + _esc(l.company_name) + '</div>' +
          (l.contact_name ? '<div style="font-size:10px;color:#888">' + _esc(l.contact_name) + '</div>' : '') +
          (l.estimated_aed ? '<div style="font-size:11px;color:#A8FF00;font-weight:700;margin-top:6px">AED ' + l.estimated_aed.toLocaleString() + ' MRR</div>' : '') +
          (l.next_action ? '<div style="font-size:10px;color:#888;margin-top:6px;font-style:italic">→ ' + _esc(l.next_action.slice(0, 50)) + '</div>' : '') +
        '</div>';
      }).join('');
    }
    html += '</div>';
  });
  html += '</div>';

  host.innerHTML = html;
}

function newCorporateLeadForm() {
  var wrap = document.getElementById('corpLeadFormWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:18px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:16px;font-weight:800;color:#A8FF00;text-transform:uppercase;margin-bottom:12px">New lead</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Company *</label><input class="admin-form-input" id="leadCompany" placeholder="Acme Corp"></div>' +
        '<div><label class="admin-form-label">Industry</label><input class="admin-form-input" id="leadIndustry" placeholder="Financial services"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Contact name</label><input class="admin-form-input" id="leadContactName"></div>' +
        '<div><label class="admin-form-label">Email</label><input class="admin-form-input" id="leadEmail"></div>' +
        '<div><label class="admin-form-label">Phone</label><input class="admin-form-input" id="leadPhone"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label"># employees</label><input class="admin-form-input" type="number" id="leadEmployees"></div>' +
        '<div><label class="admin-form-label">Estimated AED MRR</label><input class="admin-form-input" type="number" id="leadAed" placeholder="24000"></div>' +
        '<div><label class="admin-form-label">Source</label><input class="admin-form-input" id="leadSource" placeholder="LinkedIn / referral / cold"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Next action</label><input class="admin-form-input" id="leadNextAction" placeholder="Send pitch deck this Friday"></div>' +
        '<div><label class="admin-form-label">Next action date</label><input class="admin-form-input" type="date" id="leadNextDate"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label">Notes</label><textarea class="admin-form-input" id="leadNotes" rows="2"></textarea></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="saveCorporateLead" style="font-size:12px">Save lead</button>' +
        '<button class="admin-btn" data-atp-call="cancelCorpLeadForm" style="font-size:12px">Cancel</button>' +
      '</div>' +
    '</div>';
}

function cancelCorpLeadForm() { var w = document.getElementById('corpLeadFormWrap'); if (w) w.innerHTML = ''; }

function saveCorporateLead() {
  var body = {
    company_name: document.getElementById('leadCompany').value.trim(),
    industry: document.getElementById('leadIndustry').value.trim(),
    contact_name: document.getElementById('leadContactName').value.trim(),
    contact_email: document.getElementById('leadEmail').value.trim(),
    contact_phone: document.getElementById('leadPhone').value.trim(),
    estimated_employees: document.getElementById('leadEmployees').value,
    estimated_aed: document.getElementById('leadAed').value,
    source: document.getElementById('leadSource').value.trim(),
    next_action: document.getElementById('leadNextAction').value.trim(),
    next_action_date: document.getElementById('leadNextDate').value || null,
    notes: document.getElementById('leadNotes').value.trim(),
  };
  if (!body.company_name) { showToast('❌ Company required', true); return; }
  fetch(ATP_API + '/corporate/admin/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Lead added');
      cancelCorpLeadForm();
      loadCorporateLeads();
    });
}

function editCorporateLead(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  // Fetch + show inline edit form (simplified — opens stage advance modal)
  var stages = [
    { v: 'new', l: 'New' },
    { v: 'qualified', l: 'Qualified' },
    { v: 'pitch_sent', l: 'Pitch sent' },
    { v: 'negotiating', l: 'Negotiating' },
    { v: 'won', l: '✓ Won' },
    { v: 'lost', l: '✗ Lost' },
  ];
  var newStage = prompt('Advance stage to:\n\n' + stages.map(function(s, i){ return (i+1) + '. ' + s.l; }).join('\n') + '\n\nType number (1-6):');
  if (!newStage) return;
  var idx = parseInt(newStage, 10) - 1;
  if (idx < 0 || idx >= stages.length) { showToast('❌ Invalid', true); return; }
  fetch(ATP_API + '/corporate/admin/leads/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({ stage: stages[idx].v }),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Stage updated to ' + stages[idx].l);
      loadCorporateLeads();
    });
}

/* ── PACKAGES CATALOGUE ────────────────────────────────────────
 * The sellable corporate catalogue (flat monthly partnership fee).
 * Prices live in the DB so they can be retuned here without a deploy —
 * GET /api/corporate/packages feeds the public corporate.html pricing
 * section, so a save here changes the sales page instantly.
 * ──────────────────────────────────────────────────────────── */
function loadCorporatePackages() {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading packages…</div>';
  fetch(ATP_API + '/corporate/admin/packages', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      CORP_PACKAGES = (d && d.packages) || [];
      renderCorporatePackages(CORP_PACKAGES);
    })
    .catch(function(){ host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load packages. Migration run?</div>'; });
}

function renderCorporatePackages(packages) {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  var active = packages.filter(function(p){ return p.is_active; });
  var lowest = active.reduce(function(m, p){ return Math.min(m, Number(p.monthly_fee_aed) || 0); }, Infinity);
  if (!isFinite(lowest)) lowest = 0;
  var totalSessions = active.reduce(function(s, p){ return s + (Number(p.sessions_per_month) || 0); }, 0);

  var html =
    '<div style="display:grid;grid-template-columns:repeat(3,1fr) auto;gap:14px;margin-bottom:18px">' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px"><div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Live packages</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#fff">' + active.length + ' <span style="font-size:12px;color:#666;font-family:inherit;font-weight:500">/ ' + packages.length + ' total</span></div></div>' +
      '<div style="background:#0f0f0f;border:1px solid rgba(168,255,0,.32);border-radius:10px;padding:18px"><div style="font-size:10px;color:#A8FF00;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Entry price</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#A8FF00">AED ' + lowest.toLocaleString() + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px"><div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Sessions/mo across tiers</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#fff">' + totalSessions + '</div></div>' +
      '<div style="display:flex;align-items:center;justify-content:center"><button class="admin-btn admin-btn-primary" data-atp-call="newCorporatePackageForm" style="font-size:13px;padding:10px 20px;white-space:nowrap">+ Add package</button></div>' +
    '</div>' +
    '<div style="font-size:11px;color:#666;line-height:1.6;margin-bottom:14px">Edit a price and hit <strong style="color:#A8FF00">Save</strong> — the public pricing section on <code style="background:#0a0a0a;padding:2px 6px;border-radius:3px;color:#f5c042">/corporate</code> updates instantly, no deploy needed. Only one package can be <strong style="color:#f5c042">featured</strong>; featuring one un-features the rest.</div>' +
    '<div id="corpPackageFormWrap"></div>';

  if (!packages.length) {
    html += '<div style="padding:40px;color:#555;text-align:center;border:1px dashed #2a2a2a;border-radius:10px">No packages yet. Click "+ Add package" to build the catalogue.</div>';
  } else {
    html += packages.map(_corpPackageCard).join('');
  }
  host.innerHTML = html;
}

// One editable package card. Price + sessions sit front-and-centre;
// everything else is one grid below it. Save PATCHes the whole card.
function _corpPackageCard(p) {
  var features = Array.isArray(p.features) ? p.features : [];
  var dim = p.is_active ? '' : 'opacity:.55;';
  var borderCol = p.is_featured ? 'rgba(245,192,66,.42)' : '#1e1e1e';
  return '<div id="pkgCard_' + p.id + '" style="background:#0f0f0f;border:1px solid ' + borderCol + ';border-radius:10px;padding:18px;margin-bottom:12px;' + dim + '">' +
    // Header — name + badges
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">' +
      '<span style="font-family:var(--ff-display,sans-serif);font-size:18px;font-weight:800;color:#fff">' + _esc(p.name) + '</span>' +
      '<code style="background:#0a0a0a;padding:3px 8px;border-radius:4px;color:#888;font-size:11px">' + _esc(p.slug) + '</code>' +
      (p.is_featured ? '<span style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#f5c042;border:1px solid rgba(245,192,66,.4);padding:2px 7px;border-radius:4px">★ Featured</span>' : '') +
      (p.is_active ? '' : '<span style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#666;border:1px solid #2a2a2a;padding:2px 7px;border-radius:4px">Inactive</span>') +
      '<span id="pkgDirty_' + p.id + '" style="margin-left:auto;font-size:11px;color:#f59e0b;font-weight:700;display:none">● Unsaved changes</span>' +
    '</div>' +
    // Money row — the founder's headline controls
    '<div style="display:grid;grid-template-columns:1.1fr 1.1fr 1fr .7fr;gap:10px;margin-bottom:12px">' +
      '<div>' +
        '<label class="admin-form-label" style="color:#A8FF00">Monthly fee (AED)</label>' +
        '<input class="admin-form-input" type="number" min="0" step="1" id="pkgMonthly_' + p.id + '" value="' + (Number(p.monthly_fee_aed) || 0) + '" oninput="corpPkgDirty(\'' + p.id + '\')" onkeydown="if(event.key===\'Enter\'){saveCorporatePackage(\'' + p.id + '\')}" style="font-size:18px;font-weight:800;color:#A8FF00;border-color:rgba(168,255,0,.28)">' +
      '</div>' +
      '<div>' +
        '<label class="admin-form-label">Annual fee (AED)</label>' +
        '<input class="admin-form-input" type="number" min="0" step="1" id="pkgAnnual_' + p.id + '" value="' + (p.annual_fee_aed == null ? '' : Number(p.annual_fee_aed)) + '" placeholder="optional" oninput="corpPkgDirty(\'' + p.id + '\')" onkeydown="if(event.key===\'Enter\'){saveCorporatePackage(\'' + p.id + '\')}">' +
      '</div>' +
      '<div>' +
        '<label class="admin-form-label" style="color:#A8FF00">Private sessions / month</label>' +
        '<input class="admin-form-input" type="number" min="0" step="1" id="pkgSessions_' + p.id + '" value="' + (Number(p.sessions_per_month) || 0) + '" oninput="corpPkgDirty(\'' + p.id + '\')" onkeydown="if(event.key===\'Enter\'){saveCorporatePackage(\'' + p.id + '\')}" style="font-weight:700">' +
      '</div>' +
      '<div>' +
        '<label class="admin-form-label">Sort</label>' +
        '<input class="admin-form-input" type="number" step="1" id="pkgSort_' + p.id + '" value="' + (Number(p.sort_order) || 0) + '" oninput="corpPkgDirty(\'' + p.id + '\')">' +
      '</div>' +
    '</div>' +
    // Name + tagline
    '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:12px">' +
      '<div><label class="admin-form-label">Name</label><input class="admin-form-input" id="pkgName_' + p.id + '" value="' + _esc(p.name) + '" oninput="corpPkgDirty(\'' + p.id + '\')"></div>' +
      '<div><label class="admin-form-label">Tagline</label><input class="admin-form-input" id="pkgTagline_' + p.id + '" value="' + _esc(p.tagline || '') + '" placeholder="For teams getting started" oninput="corpPkgDirty(\'' + p.id + '\')"></div>' +
    '</div>' +
    // Features
    '<div style="margin-bottom:12px">' +
      '<label class="admin-form-label">Features — one per line (' + features.length + ')</label>' +
      '<textarea class="admin-form-input" id="pkgFeatures_' + p.id + '" rows="' + Math.max(4, Math.min(12, features.length + 1)) + '" oninput="corpPkgDirty(\'' + p.id + '\')" style="font-family:var(--ff-body);line-height:1.6;resize:vertical">' + _esc(features.join('\n')) + '</textarea>' +
    '</div>' +
    // Flags + actions
    '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#f5c042;cursor:pointer"><input type="checkbox" id="pkgFeatured_' + p.id + '"' + (p.is_featured ? ' checked' : '') + ' onchange="corpFeatureExclusive(\'' + p.id + '\')"> ★ Featured (most popular)</label>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#aaa;cursor:pointer"><input type="checkbox" id="pkgActive_' + p.id + '"' + (p.is_active ? ' checked' : '') + ' onchange="corpPkgDirty(\'' + p.id + '\')"> Active (shown on /corporate)</label>' +
      '<div style="margin-left:auto;display:flex;gap:8px">' +
        '<button class="admin-btn admin-btn-primary" id="pkgSave_' + p.id + '" data-atp-call="saveCorporatePackage" data-args=\'["' + p.id + '"]\' style="font-size:12px">Save</button>' +
        '<button class="admin-btn admin-btn-danger" data-atp-call="deleteCorporatePackage" data-args=\'["' + p.id + '"]\' style="font-size:12px">Delete</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// Visual "you have unsaved edits" cue on a package card.
function corpPkgDirty(id) {
  var flag = document.getElementById('pkgDirty_' + id);
  if (flag) flag.style.display = 'inline';
  var card = document.getElementById('pkgCard_' + id);
  if (card) card.style.borderColor = 'rgba(245,158,11,.45)';
}

// Only one package can carry the "most popular" badge — un-check the
// others in the DOM the moment one is featured (the save then PATCHes
// the un-featured ones too, so the DB matches what's on screen).
function corpFeatureExclusive(id) {
  var el = document.getElementById('pkgFeatured_' + id);
  if (el && el.checked) {
    CORP_PACKAGES.forEach(function(p){
      if (p.id === id) return;
      var other = document.getElementById('pkgFeatured_' + p.id);
      if (other && other.checked) { other.checked = false; corpPkgDirty(p.id); }
    });
  }
  corpPkgDirty(id);
}

function _corpPatchPackage(id, body) {
  return fetch(ATP_API + '/corporate/admin/packages/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  }).then(function(r){ return r.json(); });
}

function saveCorporatePackage(id) {
  if (!id || typeof id !== 'string') return;
  var el = function(prefix){ return document.getElementById('pkg' + prefix + '_' + id); };
  if (!el('Name')) return;
  var annualRaw = (el('Annual').value || '').trim();
  var body = {
    name: el('Name').value.trim(),
    tagline: el('Tagline').value.trim() || null,
    monthly_fee_aed: Math.max(0, parseInt(el('Monthly').value, 10) || 0),
    annual_fee_aed: annualRaw === '' ? null : Math.max(0, parseInt(annualRaw, 10) || 0),
    sessions_per_month: Math.max(0, parseInt(el('Sessions').value, 10) || 0),
    sort_order: parseInt(el('Sort').value, 10) || 0,
    features: (el('Features').value || '').split('\n').map(function(s){ return s.trim(); }).filter(Boolean),
    is_featured: !!el('Featured').checked,
    is_active: !!el('Active').checked,
  };
  if (!body.name) { showToast('❌ Package name required', true); return; }

  // Featuring this one means un-featuring every other package first.
  var pre = [];
  if (body.is_featured) {
    CORP_PACKAGES.forEach(function(p){
      if (p.id !== id && p.is_featured) pre.push(_corpPatchPackage(p.id, { is_featured: false }));
    });
  }
  var btn = document.getElementById('pkgSave_' + id);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  Promise.all(pre)
    .then(function(){ return _corpPatchPackage(id, body); })
    .then(function(res){
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ ' + body.name + ' saved · AED ' + body.monthly_fee_aed.toLocaleString() + '/mo · ' + body.sessions_per_month + ' session' + (body.sessions_per_month === 1 ? '' : 's') + '/mo');
      loadCorporatePackages();
    })
    .catch(function(err){
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      showToast('❌ ' + (err.message || 'Save failed'), true);
    });
}

function deleteCorporatePackage(id) {
  if (!id || typeof id !== 'string') return;
  var pkg = CORP_PACKAGES.filter(function(p){ return p.id === id; })[0] || {};
  if (!confirm('Delete the "' + (pkg.name || 'this') + '" package?\n\nIf any corporate account is already on it, it is deactivated instead (hidden from /corporate) so signed clients keep their pricing.')) return;
  fetch(ATP_API + '/corporate/admin/packages/' + id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      if (res.deactivated) {
        showToast('⚠ Not deleted — ' + res.accounts_using + ' account' + (res.accounts_using === 1 ? ' is' : 's are') + ' on this package. Deactivated instead (hidden from /corporate, existing clients keep it).', true);
        alert('"' + (pkg.name || 'This package') + '" could not be deleted.\n\n' + res.accounts_using + ' corporate account' + (res.accounts_using === 1 ? '' : 's') + ' still reference it, so it was DEACTIVATED instead:\n\n• It disappears from the public /corporate pricing section\n• Accounts already on it keep their price and entitlement\n\nMove those accounts to another package first if you really want it gone.');
      } else {
        showToast('✅ Package deleted');
      }
      loadCorporatePackages();
    })
    .catch(function(err){ showToast('❌ ' + (err.message || 'Delete failed'), true); });
}

function newCorporatePackageForm() {
  var wrap = document.getElementById('corpPackageFormWrap');
  if (!wrap) return;
  if (wrap.innerHTML) { wrap.innerHTML = ''; return; }
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:18px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:16px;font-weight:800;color:#A8FF00;text-transform:uppercase;margin-bottom:12px">New package</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Name *</label><input class="admin-form-input" id="newPkgName" placeholder="Champion"></div>' +
        '<div><label class="admin-form-label">Slug *</label><input class="admin-form-input" id="newPkgSlug" placeholder="champion"></div>' +
        '<div><label class="admin-form-label">Tagline</label><input class="admin-form-input" id="newPkgTagline" placeholder="Our most popular partnership"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label" style="color:#A8FF00">Monthly fee (AED) *</label><input class="admin-form-input" type="number" min="0" id="newPkgMonthly" placeholder="6000"></div>' +
        '<div><label class="admin-form-label">Annual fee (AED)</label><input class="admin-form-input" type="number" min="0" id="newPkgAnnual" placeholder="61200"></div>' +
        '<div><label class="admin-form-label" style="color:#A8FF00">Sessions / month</label><input class="admin-form-input" type="number" min="0" id="newPkgSessions" placeholder="4"></div>' +
        '<div><label class="admin-form-label">Sort order</label><input class="admin-form-input" type="number" id="newPkgSort" placeholder="2"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label">Features — one per line</label><textarea class="admin-form-input" id="newPkgFeatures" rows="5" placeholder="4 private company sessions / month&#10;Unlimited free ATP access for all staff&#10;Monthly participation report" style="line-height:1.6;resize:vertical"></textarea></div>' +
      '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#f5c042;cursor:pointer"><input type="checkbox" id="newPkgFeatured"> ★ Featured (un-features the current one)</label>' +
        '<div style="margin-left:auto;display:flex;gap:8px">' +
          '<button class="admin-btn admin-btn-primary" data-atp-call="saveNewCorporatePackage" style="font-size:12px">Create package</button>' +
          '<button class="admin-btn" data-atp-call="cancelCorporatePackageForm" style="font-size:12px">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function cancelCorporatePackageForm() { var w = document.getElementById('corpPackageFormWrap'); if (w) w.innerHTML = ''; }

function saveNewCorporatePackage() {
  var name = (document.getElementById('newPkgName').value || '').trim();
  var slug = (document.getElementById('newPkgSlug').value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!name) { showToast('❌ Name required', true); return; }
  if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  var annualRaw = (document.getElementById('newPkgAnnual').value || '').trim();
  var featured = !!document.getElementById('newPkgFeatured').checked;
  var body = {
    slug: slug,
    name: name,
    tagline: (document.getElementById('newPkgTagline').value || '').trim() || null,
    monthly_fee_aed: Math.max(0, parseInt(document.getElementById('newPkgMonthly').value, 10) || 0),
    annual_fee_aed: annualRaw === '' ? null : Math.max(0, parseInt(annualRaw, 10) || 0),
    sessions_per_month: Math.max(0, parseInt(document.getElementById('newPkgSessions').value, 10) || 0),
    sort_order: parseInt(document.getElementById('newPkgSort').value, 10) || 99,
    features: (document.getElementById('newPkgFeatures').value || '').split('\n').map(function(s){ return s.trim(); }).filter(Boolean),
    is_featured: featured,
  };
  var pre = [];
  if (featured) {
    CORP_PACKAGES.forEach(function(p){ if (p.is_featured) pre.push(_corpPatchPackage(p.id, { is_featured: false })); });
  }
  Promise.all(pre)
    .then(function(){
      return fetch(ATP_API + '/corporate/admin/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify(body),
      }).then(function(r){ return r.json(); });
    })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ ' + name + ' created · AED ' + body.monthly_fee_aed.toLocaleString() + '/mo');
      cancelCorporatePackageForm();
      loadCorporatePackages();
    })
    .catch(function(err){ showToast('❌ ' + (err.message || 'Create failed'), true); });
}

// ── CORPORATE ACCOUNTS ─────────────────────────────────────────
function loadCorporateAccounts() {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading accounts…</div>';
  fetch(ATP_API + '/corporate/admin/accounts', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){ renderCorporateAccounts((d && d.accounts) || []); })
    .catch(function(){ host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed</div>'; });
}

function renderCorporateAccounts(accounts) {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  var origin = window.location.origin;
  var totalMRR = accounts.filter(function(a){ return a.status === 'active'; }).reduce(function(s, a){ return s + (a.monthly_fee_aed || 0); }, 0);
  var totalEmployees = accounts.reduce(function(s, a){ return s + (a.employee_count || 0); }, 0);

  var html =
    '<div style="display:grid;grid-template-columns:repeat(3,1fr) auto;gap:14px;margin-bottom:18px">' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px"><div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Active accounts</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#fff">' + accounts.filter(function(a){ return a.status === 'active'; }).length + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid rgba(168,255,0,.32);border-radius:10px;padding:18px"><div style="font-size:10px;color:#A8FF00;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Total MRR</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#A8FF00">AED ' + totalMRR.toLocaleString() + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px"><div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Employees enrolled</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#fff">' + totalEmployees + '</div></div>' +
      '<div style="display:flex;align-items:center;justify-content:center"><button class="admin-btn admin-btn-primary" data-atp-call="newCorporateAccountForm" style="font-size:13px;padding:10px 20px;white-space:nowrap">+ New account</button></div>' +
    '</div>' +
    '<div id="corpAccountFormWrap"></div>';

  if (!accounts.length) {
    html += '<div style="padding:40px;color:#555;text-align:center;border:1px dashed #2a2a2a;border-radius:10px">No corporate accounts yet. Close a lead and create one here.</div>';
  } else {
    html += accounts.map(function(a){
      var statusColor = a.status === 'active' ? '#A8FF00' : (a.status === 'paused' ? '#f59e0b' : '#666');
      var inviteUrl = a.latest_token ? (origin + '/corporate/join/' + a.latest_token) : null;
      return '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px;margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">' +
          '<div style="flex:1">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
              '<span style="font-family:var(--ff-display,sans-serif);font-size:18px;font-weight:800;color:#fff">' + _esc(a.company_name) + '</span>' +
              '<span style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:' + statusColor + ';border:1px solid ' + statusColor + ';padding:2px 7px;border-radius:4px">' + a.status + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:#888">' +
              '<strong style="color:#A8FF00">AED ' + (a.monthly_fee_aed || 0).toLocaleString() + '/mo</strong>' +
              ' · ' + (a.employee_count || 0) + ' / ' + (a.employee_cap || '∞') + ' employees' +
              ' · ' + (a.contact_email || 'no contact') +
            '</div>' +
            (inviteUrl ? '<div style="margin-top:10px;display:flex;gap:6px;align-items:center"><code style="background:#0a0a0a;padding:4px 10px;border-radius:4px;color:#A8FF00;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + inviteUrl + '</code>' +
              '<button class="admin-btn" onclick="navigator.clipboard.writeText(\'' + inviteUrl + '\').then(function(){showToast(\'✅ Copied\')})" style="font-size:11px;padding:4px 10px">Copy</button>' +
            '</div>' : '') +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px">' +
            '<button class="admin-btn admin-btn-primary" data-atp-call="openCorporateAccountDetail" data-args=\'["' + a.id + '"]\' style="font-size:11px;padding:6px 12px">⚙️ Manage</button>' +
            '<a class="admin-btn" href="/corporate/dashboard/' + a.slug + '" target="_blank" style="font-size:11px;padding:6px 12px;text-decoration:none">📊 Buyer view</a>' +
            '<button class="admin-btn" data-atp-call="viewCorporateEngagement" data-args=\'["' + a.id + '","' + _esc(a.company_name) + '"]\' style="font-size:11px;padding:6px 12px">📈 Engagement</button>' +
          '</div>' +
        '</div>' +
        '<div id="engagement-' + a.id + '"></div>' +
      '</div>';
    }).join('');
  }
  host.innerHTML = html;
}

function newCorporateAccountForm() {
  var wrap = document.getElementById('corpAccountFormWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:18px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:16px;font-weight:800;color:#A8FF00;text-transform:uppercase;margin-bottom:12px">New corporate account</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Company *</label><input class="admin-form-input" id="accCompany" placeholder="Acme Corp"></div>' +
        '<div><label class="admin-form-label">Industry</label><input class="admin-form-input" id="accIndustry"></div>' +
        '<div><label class="admin-form-label">Slug (URL part)</label><input class="admin-form-input" id="accSlug" placeholder="auto"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Contact name</label><input class="admin-form-input" id="accContactName"></div>' +
        '<div><label class="admin-form-label">Email</label><input class="admin-form-input" id="accEmail"></div>' +
        '<div><label class="admin-form-label">Phone</label><input class="admin-form-input" id="accPhone"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Employee cap</label><input class="admin-form-input" type="number" id="accCap" placeholder="200"></div>' +
        '<div><label class="admin-form-label">Monthly fee (AED) *</label><input class="admin-form-input" type="number" id="accMonthly" placeholder="24000"></div>' +
        '<div><label class="admin-form-label">Start date</label><input class="admin-form-input" type="date" id="accStart"></div>' +
        '<div><label class="admin-form-label">End date</label><input class="admin-form-input" type="date" id="accEnd"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px">' +
        '<label class="admin-form-label">Company logo</label>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<input class="admin-form-input" id="accLogoUrl" placeholder="Paste URL or upload" style="flex:1">' +
          '<input type="file" id="accLogoUrlFile" accept="image/png,image/svg+xml,image/webp" style="display:none" onchange="atpUpload(\'accLogoUrlFile\',\'accLogoUrl\',\'image\',1)">' +
          '<button type="button" class="admin-btn" style="font-size:11px;padding:9px 14px;white-space:nowrap" onclick="document.getElementById(\'accLogoUrlFile\').click()">📁 Upload</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#666;margin-top:4px;line-height:1.5">📐 Square <strong style="color:#aaa">256 × 256&nbsp;px</strong> (1:1) · PNG or SVG with transparent BG · &lt; 100&nbsp;KB.</div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label">Notes</label><textarea class="admin-form-input" id="accNotes" rows="2"></textarea></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="saveCorporateAccount" style="font-size:12px">Create account + signup token</button>' +
        '<button class="admin-btn" data-atp-call="cancelCorpAccountForm" style="font-size:12px">Cancel</button>' +
      '</div>' +
    '</div>';
}

function cancelCorpAccountForm() { var w = document.getElementById('corpAccountFormWrap'); if (w) w.innerHTML = ''; }

function saveCorporateAccount() {
  var body = {
    company_name: document.getElementById('accCompany').value.trim(),
    industry: document.getElementById('accIndustry').value.trim(),
    slug: document.getElementById('accSlug').value.trim(),
    contact_name: document.getElementById('accContactName').value.trim(),
    contact_email: document.getElementById('accEmail').value.trim(),
    contact_phone: document.getElementById('accPhone').value.trim(),
    employee_cap: document.getElementById('accCap').value,
    monthly_fee_aed: document.getElementById('accMonthly').value,
    start_date: document.getElementById('accStart').value || null,
    end_date: document.getElementById('accEnd').value || null,
    notes: document.getElementById('accNotes').value.trim(),
  };
  var rawLogo = document.getElementById('accLogoUrl').value.trim();
  if (rawLogo) {
    if (!/^https:\/\//i.test(rawLogo) && !/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/i.test(rawLogo) && !/^\/api\/cms\/media\//.test(rawLogo)) {
      showToast('❌ Logo must be https:// , data:image/…;base64, or an /api/cms/media/… upload', true); return;
    }
    body.logo_url = rawLogo;
  }
  if (!body.company_name || !body.monthly_fee_aed) { showToast('❌ Company + monthly fee required', true); return; }
  fetch(ATP_API + '/corporate/admin/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      var url = window.location.origin + '/corporate/join/' + res.signup_token;
      showToast('✅ Account created · invite URL copied');
      try { navigator.clipboard.writeText(url); } catch(e){}
      cancelCorpAccountForm();
      loadCorporateAccounts();
    });
}

function viewCorporateEngagement(e, btn) {
  var args = JSON.parse(btn.getAttribute('data-args') || '[]');
  var id = args[0];
  var host = document.getElementById('engagement-' + id);
  if (!host) return;
  if (host.innerHTML) { host.innerHTML = ''; return; }
  host.innerHTML = '<div style="padding:14px;color:#555">Loading engagement…</div>';
  fetch(ATP_API + '/corporate/admin/accounts/' + id + '/engagement', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var t = d.totals || {};
      var a = d.activity || {};
      var participation = t.active_employees ? Math.round(100 * (a.unique_30d || 0) / t.active_employees) : 0;
      host.innerHTML =
        '<div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:8px;padding:14px;margin-top:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px">' +
          '<div><div style="font-size:9px;color:#888;letter-spacing:.1em;text-transform:uppercase">Total enrolled</div><div style="font-family:var(--ff-display,sans-serif);font-size:22px;font-weight:900;color:#fff">' + (t.total_employees || 0) + '</div></div>' +
          '<div><div style="font-size:9px;color:#888;letter-spacing:.1em;text-transform:uppercase">Active 30d (unique)</div><div style="font-family:var(--ff-display,sans-serif);font-size:22px;font-weight:900;color:#A8FF00">' + (a.unique_30d || 0) + ' <span style="font-size:11px;color:#888;font-weight:500;font-family:inherit">/ ' + participation + '%</span></div></div>' +
          '<div><div style="font-size:9px;color:#888;letter-spacing:.1em;text-transform:uppercase">Check-ins 30d</div><div style="font-family:var(--ff-display,sans-serif);font-size:22px;font-weight:900;color:#fff">' + (a.checkins_30d || 0) + '</div></div>' +
          '<div><div style="font-size:9px;color:#888;letter-spacing:.1em;text-transform:uppercase">Check-ins 7d</div><div style="font-family:var(--ff-display,sans-serif);font-size:22px;font-weight:900;color:#fff">' + (a.checkins_7d || 0) + '</div></div>' +
        '</div>';
    });
}

// ── ACCOUNT DETAIL VIEW (Phase 1) ──────────────────────────────
function openCorporateAccountDetail(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!id) return;
  CORP_ACTIVE_ID = id;
  CORP_VIEW = 'account_detail';
  renderCorporateSubtabs();
  loadCorporateAccountDetail(id);
}

function loadCorporateAccountDetail(id) {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading company detail…</div>';
  var auth = { headers: { Authorization: 'Bearer ' + getToken() } };
  Promise.all([
    fetch(ATP_API + '/corporate/admin/accounts/' + id, auth).then(function(r){return r.json();}),
    fetch(ATP_API + '/corporate/admin/accounts/' + id + '/employees', auth).then(function(r){return r.json();}),
    fetch(ATP_API + '/corporate/admin/accounts/' + id + '/engagement', auth).then(function(r){return r.json();}),
    // Catalogue + private-session delivery. Both are additive — if either
    // endpoint isn't deployed yet the rest of the detail view still renders.
    fetch(ATP_API + '/corporate/admin/packages', auth).then(function(r){return r.json();}).catch(function(){ return {}; }),
    fetch(ATP_API + '/corporate/admin/accounts/' + id + '/delivery', auth).then(function(r){return r.json();}).catch(function(){ return null; }),
  ]).then(function(out){
    CORP_ACTIVE_ACCOUNT = out[0] && out[0].account;
    CORP_PACKAGES = (out[3] && out[3].packages) || [];
    renderCorporateAccountDetail(CORP_ACTIVE_ACCOUNT, (out[1] && out[1].employees) || [], out[2] || {}, CORP_PACKAGES, out[4]);
  }).catch(function(){
    host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load. Migration run?</div>';
  });
}

function renderCorporateAccountDetail(a, employees, engagement, packages, delivery) {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  if (!a) { host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Account not found</div>'; return; }

  var origin = window.location.origin;
  var statusColor = a.status === 'active' ? '#A8FF00' : (a.status === 'paused' ? '#f59e0b' : '#666');
  var inviteUrl = a.latest_token ? (origin + '/corporate/join/' + a.latest_token) : null;
  var pilotEnds = a.pilot_ends_at ? new Date(a.pilot_ends_at) : null;
  var pilotDaysLeft = pilotEnds ? Math.ceil((pilotEnds.getTime() - Date.now()) / 86400000) : null;
  var pilotBanner = '';
  if (pilotDaysLeft != null && pilotDaysLeft > 0) {
    pilotBanner = '<div style="background:rgba(245,192,66,.10);border:1px solid rgba(245,192,66,.35);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#f5c042;font-weight:600">⏰ Pilot ends in ' + pilotDaysLeft + ' day' + (pilotDaysLeft === 1 ? '' : 's') + ' · ' + pilotEnds.toLocaleDateString() + '</div>';
  } else if (pilotDaysLeft != null && pilotDaysLeft <= 0) {
    pilotBanner = '<div style="background:rgba(239,68,68,.10);border:1px solid rgba(239,68,68,.35);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#ef4444;font-weight:600">⚠ Pilot expired ' + Math.abs(pilotDaysLeft) + ' days ago — convert to paid or pause</div>';
  }
  var et = engagement.totals || {};
  var ea = engagement.activity || {};
  var activeCount = a.active_employee_count || 0;
  var participation = activeCount ? Math.round(100 * (ea.unique_30d || 0) / activeCount) : 0;
  var inactive30 = Math.max(0, activeCount - (ea.unique_30d || 0));

  var html =
    // Header — back + company name + actions
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:14px">' +
        '<button class="admin-btn" data-atp-call="showCorporateTab" data-args=\'["accounts"]\' style="font-size:11px;padding:6px 12px">← All accounts</button>' +
        '<div style="position:relative">' +
          (a.logo_url ? '<img src="' + _esc(a.logo_url) + '" alt="logo" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\';" style="width:48px;height:48px;border-radius:8px;background:linear-gradient(45deg,#1a1a1a 25%,#222 25%,#222 50%,#1a1a1a 50%,#1a1a1a 75%,#222 75%);background-size:8px 8px;padding:4px;object-fit:contain;border:1px solid rgba(255,255,255,.08)"><div style="display:none;width:48px;height:48px;border-radius:8px;background:#1a1a1a;align-items:center;justify-content:center;font-family:var(--ff-display,sans-serif);font-size:11px;color:#ef4444;font-weight:700">404</div>' : '<div style="width:48px;height:48px;border-radius:8px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-family:var(--ff-display,sans-serif);font-size:22px;color:#A8FF00;font-weight:700">' + _esc((a.company_name||'?').charAt(0).toUpperCase()) + '</div>') +
          '<button title="Edit logo" data-atp-call="editCorporateLogo" data-args=\'["' + a.id + '"]\' style="position:absolute;bottom:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:#A8FF00;color:#0a0a0a;border:2px solid #0a0a0a;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700;padding:0">✎</button>' +
        '</div>' +
        '<div>' +
          '<div style="font-family:var(--ff-display,sans-serif);font-size:24px;font-weight:800;color:#fff;line-height:1.1">' + _esc(a.company_name) + '</div>' +
          '<div style="font-size:11px;color:#888;margin-top:3px"><span style="color:' + statusColor + ';text-transform:uppercase;font-weight:700;letter-spacing:.06em">' + _esc(a.status) + '</span>' +
            (a.tier ? ' · ' + _esc(a.tier) + ' tier' : '') +
            (a.industry ? ' · ' + _esc(a.industry) : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        (a.status !== 'active' ? '<button class="admin-btn admin-btn-primary" data-atp-call="activateCorporateAccount" data-args=\'["' + a.id + '"]\' style="font-size:11px;padding:6px 12px">✓ Activate account</button>' : '') +
        '<button class="admin-btn" data-atp-call="copyInviteUrl" data-args=\'["' + (inviteUrl || '') + '"]\' style="font-size:11px;padding:6px 12px">📋 Copy invite link</button>' +
        '<a class="admin-btn" href="/corporate/dashboard/' + a.slug + '" target="_blank" style="font-size:11px;padding:6px 12px;text-decoration:none">📊 Buyer view</a>' +
      '</div>' +
    '</div>' +
    '<div id="corpLogoEditWrap"></div>' +
    pilotBanner +
    // KPI strip
    '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px">' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px"><div style="font-size:9px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Total enrolled</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#fff">' + (a.employee_count || 0) + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid rgba(168,255,0,.32);border-radius:8px;padding:14px"><div style="font-size:9px;color:#A8FF00;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Active</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#A8FF00">' + activeCount + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px"><div style="font-size:9px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Active 30d (unique)</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#fff">' + (ea.unique_30d || 0) + ' <span style="font-size:11px;font-family:inherit;color:#888;font-weight:500">/ ' + participation + '%</span></div></div>' +
      '<div style="background:#0f0f0f;border:1px solid rgba(245,158,11,.32);border-radius:8px;padding:14px"><div style="font-size:9px;color:#f59e0b;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Inactive (>30d)</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#f59e0b">' + inactive30 + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px"><div style="font-size:9px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">AED MRR</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#fff">' + (a.monthly_fee_aed || 0).toLocaleString() + '</div></div>' +
    '</div>' +
    // Package assignment + private-session delivery counter
    _corpPackagePanel(a, packages || [], delivery) +
    // Add employee form (collapsed)
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:18px;font-weight:800;color:#fff">Employees (' + employees.length + ')</div>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="admin-btn" data-atp-call="openCorpCsvUpload" style="font-size:12px;padding:7px 14px">📂 Upload CSV</button>' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="newCorpEmployeeForm" style="font-size:12px;padding:7px 14px">+ Add employee</button>' +
      '</div>' +
    '</div>' +
    '<div id="corpEmpFormWrap"></div>' +
    '<div id="corpCsvFormWrap"></div>' +
    // Employees table
    (employees.length ?
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;overflow:hidden">' +
        '<div style="display:grid;grid-template-columns:1fr 1.2fr 0.8fr 80px 100px 100px auto;gap:14px;padding:10px 16px;background:rgba(168,255,0,.04);font-size:10px;color:#A8FF00;letter-spacing:.12em;text-transform:uppercase;font-weight:700">' +
          '<div>Name</div><div>Email</div><div>Department</div><div>Status</div><div>30d</div><div>Last seen</div><div>Actions</div>' +
        '</div>' +
        employees.map(function(e){
          var name = ((e.first_name || '') + ' ' + (e.last_name || '')).trim() || '(no name)';
          var statusBadge;
          if (e.frozen_at) statusBadge = '<span style="background:rgba(245,158,11,.14);color:#f59e0b;font-size:9px;padding:3px 8px;border-radius:99px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">Frozen</span>';
          else if (e.invitation_sent_at && !e.joined_at) statusBadge = '<span style="background:rgba(59,130,246,.14);color:#3b82f6;font-size:9px;padding:3px 8px;border-radius:99px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">Invited</span>';
          else statusBadge = '<span style="background:rgba(168,255,0,.14);color:#A8FF00;font-size:9px;padding:3px 8px;border-radius:99px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">Active</span>';
          var roleTag = e.role === 'admin' ? '<span style="background:rgba(245,192,66,.14);color:#f5c042;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:.04em;margin-left:6px">CA</span>' : '';
          var lastSeen = e.last_checkin_at ? new Date(e.last_checkin_at).toLocaleDateString('en-GB',{month:'short',day:'numeric'}) : '—';
          return '<div style="display:grid;grid-template-columns:1fr 1.2fr 0.8fr 80px 100px 100px auto;gap:14px;padding:10px 16px;border-top:1px solid #1a1a1a;align-items:center;font-size:13px">' +
            '<div style="color:#fff;font-weight:600">' + _esc(name) + roleTag + '</div>' +
            '<div style="color:#aaa;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(e.email || '') + '</div>' +
            '<div style="color:#888;font-size:12px">' + _esc(e.department || '—') + '</div>' +
            '<div>' + statusBadge + '</div>' +
            '<div style="color:#fff;font-size:13px;font-weight:600">' + (e.checkins_30d || 0) + '</div>' +
            '<div style="color:#888;font-size:11px">' + lastSeen + '</div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
              // Resend invite is shown for everyone not-yet-joined (no joined_at OR invitation_email set + no last activity)
              (!e.last_checkin_at && !e.frozen_at
                ? '<button class="admin-btn" data-atp-call="resendCorpInvite" data-args=\'["' + e.id + '"]\' style="font-size:10px;padding:4px 8px;background:rgba(59,130,246,.10);color:#3b82f6;border:1px solid rgba(59,130,246,.3)">Resend</button>'
                : '') +
              (e.frozen_at
                ? '<button class="admin-btn" data-atp-call="unfreezeCorpEmployee" data-args=\'["' + e.id + '"]\' style="font-size:10px;padding:4px 8px;background:rgba(168,255,0,.10);color:#A8FF00;border:1px solid rgba(168,255,0,.3)">Unfreeze</button>'
                : '<button class="admin-btn" data-atp-call="freezeCorpEmployee" data-args=\'["' + e.id + '"]\' style="font-size:10px;padding:4px 8px;background:rgba(245,158,11,.10);color:#f59e0b;border:1px solid rgba(245,158,11,.3)">Freeze</button>') +
              '<button class="admin-btn" data-atp-call="deleteCorpEmployee" data-args=\'["' + e.id + '","' + _esc(name).replace(/\\/g,"\\\\").replace(/"/g,"&quot;") + '"]\' style="font-size:10px;padding:4px 8px;background:rgba(239,68,68,.10);color:#ef4444;border:1px solid rgba(239,68,68,.3)">Remove</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>'
    :
      '<div style="padding:40px;color:#555;text-align:center;border:1px dashed #2a2a2a;border-radius:10px">No employees enrolled yet. Click "+ Add employee" above.</div>'
    );

  host.innerHTML = html;
}

/* ── PACKAGE + DELIVERY PANEL (account detail) ─────────────────
 * Left: which package this client is on (and their session
 * entitlement). Right: "X of Y private sessions delivered this month"
 * — what gets invoiced against, and what HR asks about.
 * ──────────────────────────────────────────────────────────── */
function _corpPackagePanel(a, packages, delivery) {
  var current = packages.filter(function(p){ return p.id === a.package_id; })[0] || null;
  var options = '<option value="">— No package —</option>' + packages.map(function(p){
    return '<option value="' + p.id + '"' + (p.id === a.package_id ? ' selected' : '') + '>' +
      _esc(p.name) + ' — AED ' + (Number(p.monthly_fee_aed) || 0).toLocaleString() + '/mo · ' +
      (Number(p.sessions_per_month) || 0) + ' session' + ((Number(p.sessions_per_month) || 0) === 1 ? '' : 's') + '/mo' +
      (p.is_active ? '' : ' (inactive)') + '</option>';
  }).join('');
  var entitlement = a.sessions_per_month != null ? Number(a.sessions_per_month) : (current ? Number(current.sessions_per_month) || 0 : 0);

  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">' +
    // ── Package assignment ──
    '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:16px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
        '<span style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Package</span>' +
        (current
          ? '<span style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#A8FF00;border:1px solid rgba(168,255,0,.35);padding:2px 7px;border-radius:4px">' + _esc(current.name) + '</span>'
          : '<span style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#f59e0b;border:1px solid rgba(245,158,11,.35);padding:2px 7px;border-radius:4px">Unassigned</span>') +
        '<button class="admin-btn" data-atp-call="showCorporateTab" data-args=\'["packages"]\' style="margin-left:auto;font-size:10px;padding:4px 9px">Edit catalogue →</button>' +
      '</div>' +
      (packages.length
        ? '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">' +
            '<div><label class="admin-form-label">Package</label><select class="admin-form-select" id="accPkgSelect" onchange="corpAccountPackageChanged()">' + options + '</select></div>' +
            '<div><label class="admin-form-label">Sessions / month</label><input class="admin-form-input" type="number" min="0" id="accPkgSessions" value="' + entitlement + '"></div>' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#aaa;cursor:pointer;margin-bottom:10px"><input type="checkbox" id="accPkgSyncFee" checked> Also set this account\'s monthly fee to the package price</label>' +
          '<button class="admin-btn admin-btn-primary" data-atp-call="saveCorporateAccountPackage" data-args=\'["' + a.id + '"]\' style="font-size:12px">Save package</button>'
        : '<div style="font-size:12px;color:#666;line-height:1.6">No packages in the catalogue yet — build one in the <strong style="color:#A8FF00">Packages</strong> tab first.</div>') +
    '</div>' +
    // ── Delivery counter ──
    _corpDeliveryWidget(delivery, entitlement) +
  '</div>';
}

// "3 of 4 private sessions delivered this month" + a lime-on-black bar.
// Solid lime = already delivered, translucent lime = still scheduled.
function _corpDeliveryWidget(d, fallbackEntitled) {
  if (!d || d.error) {
    return '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:16px">' +
      '<div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-bottom:10px">Private sessions this month</div>' +
      '<div style="font-size:12px;color:#666;line-height:1.6">Delivery data unavailable.</div></div>';
  }
  var delivered = Number(d.delivered) || 0;
  var scheduled = Number(d.scheduled) || 0;
  var entitled  = Number(d.entitled) || Number(fallbackEntitled) || 0;
  var pct       = entitled ? Math.min(100, Math.round(100 * delivered / entitled)) : (delivered ? 100 : 0);
  var schedPct  = entitled ? Math.min(100 - pct, Math.round(100 * scheduled / entitled)) : 0;
  var monthLabel = d.month
    ? new Date(d.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  var behind = entitled && (delivered + scheduled) < entitled;
  var accent = !entitled ? '#666' : (delivered >= entitled ? '#A8FF00' : (behind ? '#f59e0b' : '#A8FF00'));

  return '<div style="background:#0f0f0f;border:1px solid ' + (behind ? 'rgba(245,158,11,.32)' : 'rgba(168,255,0,.32)') + ';border-radius:10px;padding:16px">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<span style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Private sessions this month</span>' +
      '<span style="margin-left:auto;font-size:10px;color:#666">' + monthLabel + '</span>' +
    '</div>' +
    '<div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:' + accent + ';line-height:1.1;margin-bottom:4px">' +
      delivered + ' of ' + (entitled || '—') +
      '<span style="font-size:12px;color:#888;font-weight:500;font-family:inherit"> delivered</span>' +
    '</div>' +
    '<div style="font-size:11px;color:#888;margin-bottom:10px">' +
      (scheduled ? '<strong style="color:#A8FF00">' + scheduled + '</strong> more scheduled' : 'Nothing else on the calendar') +
      (entitled ? ' · ' + Math.max(0, entitled - delivered - scheduled) + ' still to book' : ' · no package entitlement set') +
    '</div>' +
    // Progress bar — brand lime on black
    '<div style="height:10px;border-radius:99px;background:#000;border:1px solid #1e1e1e;overflow:hidden;display:flex">' +
      '<div style="width:' + pct + '%;background:#A8FF00"></div>' +
      '<div style="width:' + schedPct + '%;background:rgba(168,255,0,.32)"></div>' +
    '</div>' +
    (entitled && delivered > entitled
      ? '<div style="font-size:11px;color:#A8FF00;margin-top:8px;font-weight:600">✓ Over-delivered by ' + (delivered - entitled) + '</div>'
      : (behind ? '<div style="font-size:11px;color:#f59e0b;margin-top:8px;font-weight:600">⚠ ' + (entitled - delivered - scheduled) + ' session' + ((entitled - delivered - scheduled) === 1 ? '' : 's') + ' unbooked this month</div>' : '')) +
  '</div>';
}

// Picking a package pre-fills the entitlement with that package's
// sessions/month (still editable — some clients negotiate extras).
function corpAccountPackageChanged() {
  var sel = document.getElementById('accPkgSelect');
  var sessions = document.getElementById('accPkgSessions');
  if (!sel || !sessions) return;
  var pkg = CORP_PACKAGES.filter(function(p){ return p.id === sel.value; })[0];
  sessions.value = pkg ? (Number(pkg.sessions_per_month) || 0) : 0;
}

function saveCorporateAccountPackage(id) {
  if (!id || typeof id !== 'string') return;
  var sel = document.getElementById('accPkgSelect');
  if (!sel) return;
  var pkgId = sel.value || null;
  var pkg = CORP_PACKAGES.filter(function(p){ return p.id === pkgId; })[0] || null;
  var body = {
    package_id: pkgId,
    sessions_per_month: Math.max(0, parseInt((document.getElementById('accPkgSessions') || {}).value, 10) || 0),
  };
  var sync = document.getElementById('accPkgSyncFee');
  if (sync && sync.checked && pkg) body.monthly_fee_aed = Number(pkg.monthly_fee_aed) || 0;

  fetch(ATP_API + '/corporate/admin/accounts/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) {
        // The account PATCH allowlist may not include package_id yet —
        // say so plainly instead of echoing "no fields to update".
        if (/no fields to update/i.test(res.error)) {
          showToast('⚠ API ignored package_id — add package_id + sessions_per_month to the PATCH /admin/accounts/:id allowlist', true);
        } else {
          showToast('❌ ' + res.error, true);
        }
        return;
      }
      var acc = res.account || {};
      if ((acc.package_id || null) !== (pkgId || null)) {
        showToast('⚠ Saved, but package_id was dropped by the API — its allowlist needs package_id + sessions_per_month', true);
      } else {
        showToast('✅ ' + (pkg ? pkg.name + ' assigned · ' + body.sessions_per_month + ' session' + (body.sessions_per_month === 1 ? '' : 's') + '/mo' : 'Package cleared'));
      }
      loadCorporateAccountDetail(id);
    })
    .catch(function(err){ showToast('❌ ' + (err.message || 'Save failed'), true); });
}

function newCorpEmployeeForm() {
  var wrap = document.getElementById('corpEmpFormWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:16px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#A8FF00;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Add an employee</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 2fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">First name</label><input class="admin-form-input" id="empFirst" placeholder="Sarah"></div>' +
        '<div><label class="admin-form-label">Last name</label><input class="admin-form-input" id="empLast" placeholder="Khalil"></div>' +
        '<div><label class="admin-form-label">Work email *</label><input class="admin-form-input" id="empEmail" placeholder="sarah@acme.com"></div>' +
        '<div><label class="admin-form-label">Department</label><input class="admin-form-input" id="empDept" placeholder="Marketing"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#aaa"><input type="checkbox" id="empIsAdmin"> Mark as Company Admin (CA)</label>' +
        '<div style="margin-left:auto;display:flex;gap:8px">' +
          '<button class="admin-btn admin-btn-primary" data-atp-call="saveCorpEmployee" style="font-size:12px">Save + invite</button>' +
          '<button class="admin-btn" data-atp-call="cancelCorpEmployeeForm" style="font-size:12px">Cancel</button>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:10px;font-size:11px;color:#666;line-height:1.5">If this email is already an ATP member, we link them. Otherwise we create a stub account and generate an invitation token (Phase 2 will email the magic link).</div>' +
    '</div>';
}

function cancelCorpEmployeeForm() { var w = document.getElementById('corpEmpFormWrap'); if (w) w.innerHTML = ''; }

function saveCorpEmployee() {
  if (!CORP_ACTIVE_ID) return;
  var body = {
    first_name: document.getElementById('empFirst').value.trim(),
    last_name: document.getElementById('empLast').value.trim(),
    email: document.getElementById('empEmail').value.trim(),
    department: document.getElementById('empDept').value.trim(),
    role: document.getElementById('empIsAdmin').checked ? 'admin' : 'employee',
  };
  if (!body.email) { showToast('❌ Email required', true); return; }
  fetch(ATP_API + '/corporate/admin/accounts/' + CORP_ACTIVE_ID + '/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ ' + (res.member_created ? 'Stub member created + linked' : 'Existing member linked'));
      cancelCorpEmployeeForm();
      loadCorporateAccountDetail(CORP_ACTIVE_ID);
    })
    .catch(function(err){ showToast('❌ ' + err.message, true); });
}

function freezeCorpEmployee(e, btn) {
  var eid = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!eid || !CORP_ACTIVE_ID) return;
  fetch(ATP_API + '/corporate/admin/accounts/' + CORP_ACTIVE_ID + '/employees/' + eid, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({ frozen: true }),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Employee frozen');
      loadCorporateAccountDetail(CORP_ACTIVE_ID);
    });
}

function unfreezeCorpEmployee(e, btn) {
  var eid = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!eid || !CORP_ACTIVE_ID) return;
  fetch(ATP_API + '/corporate/admin/accounts/' + CORP_ACTIVE_ID + '/employees/' + eid, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({ frozen: false }),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Employee unfrozen');
      loadCorporateAccountDetail(CORP_ACTIVE_ID);
    });
}

function deleteCorpEmployee(e, btn) {
  var args = JSON.parse(btn.getAttribute('data-args') || '[]');
  var eid = args[0], name = args[1];
  if (!eid || !CORP_ACTIVE_ID) return;
  if (!confirm('Remove ' + (name || 'this employee') + ' from this company?\n\nTheir ATP membership stays intact — they keep their session history, points, profile. Only the company link is removed.')) return;
  fetch(ATP_API + '/corporate/admin/accounts/' + CORP_ACTIVE_ID + '/employees/' + eid, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ ' + (res.note || 'Removed'));
      loadCorporateAccountDetail(CORP_ACTIVE_ID);
    });
}

function activateCorporateAccount(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!id) return;
  if (!confirm('Activate this account?\n\nThis starts the 30-day pilot clock. Employees will be able to use ATP from now.')) return;
  fetch(ATP_API + '/corporate/admin/accounts/' + id + '/activate', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Account activated · 30-day pilot started');
      loadCorporateAccountDetail(id);
    });
}

function copyInviteUrl(e, btn) {
  var url = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!url) { showToast('❌ No invite link yet — generate a token first', true); return; }
  try {
    navigator.clipboard.writeText(url);
    showToast('✅ Invite link copied');
  } catch (e) { showToast('❌ Copy failed — copy manually', true); }
}

// ── PHASE 2: CSV bulk upload + resend invite ───────────────────
function openCorpCsvUpload() {
  var wrap = document.getElementById('corpCsvFormWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:16px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#A8FF00;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Bulk upload from CSV</div>' +
      '<div style="font-size:12px;color:#aaa;line-height:1.55;margin-bottom:12px">' +
        'CSV must have a header row. Required column: <code style="background:#000;padding:2px 6px;border-radius:3px;color:#A8FF00">email</code>. ' +
        'Optional: <code style="background:#000;padding:2px 6px;border-radius:3px;color:#aaa">first_name</code>, ' +
        '<code style="background:#000;padding:2px 6px;border-radius:3px;color:#aaa">last_name</code>, ' +
        '<code style="background:#000;padding:2px 6px;border-radius:3px;color:#aaa">department</code>, ' +
        '<code style="background:#000;padding:2px 6px;border-radius:3px;color:#aaa">role</code> (use "admin" to mark a Company Admin).' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start;flex-wrap:wrap">' +
        '<input type="file" id="csvFile" accept=".csv,text/csv" style="background:#0a0a0a;border:1px solid #2a2a2a;padding:8px;color:#ddd;border-radius:6px;font-size:12px">' +
        '<button class="admin-btn" data-atp-call="pasteCsvSample" style="font-size:11px;padding:6px 10px">Paste sample</button>' +
      '</div>' +
      '<textarea id="csvText" placeholder="email,first_name,last_name,department&#10;sarah@acme.com,Sarah,Khalil,Marketing&#10;omar@acme.com,Omar,Riad,Engineering" style="width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;padding:12px;color:#ddd;font-family:monospace;font-size:12px;line-height:1.5;min-height:140px;resize:vertical"></textarea>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#aaa"><input type="checkbox" id="csvSendInvites" checked> Send invitation emails after upload</label>' +
        '<div style="margin-left:auto;display:flex;gap:8px">' +
          '<button class="admin-btn admin-btn-primary" data-atp-call="submitCorpCsv" style="font-size:12px">Upload</button>' +
          '<button class="admin-btn" data-atp-call="cancelCorpCsvForm" style="font-size:12px">Cancel</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  var fileInput = document.getElementById('csvFile');
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function(){ document.getElementById('csvText').value = reader.result; };
      reader.readAsText(f);
    });
  }
}

function pasteCsvSample() {
  var ta = document.getElementById('csvText');
  if (!ta) return;
  ta.value = 'email,first_name,last_name,department,role\n' +
             'sarah.k@acme.com,Sarah,Khalil,Marketing,employee\n' +
             'omar.r@acme.com,Omar,Riad,Engineering,employee\n' +
             'priya.m@acme.com,Priya,Mehta,Sales,admin';
}

function cancelCorpCsvForm() { var w = document.getElementById('corpCsvFormWrap'); if (w) w.innerHTML = ''; }

function submitCorpCsv() {
  if (!CORP_ACTIVE_ID) return;
  var csv = (document.getElementById('csvText').value || '').trim();
  if (!csv) { showToast('❌ Paste or upload a CSV first', true); return; }
  var sendInvites = document.getElementById('csvSendInvites').checked;
  fetch(ATP_API + '/corporate/admin/accounts/' + CORP_ACTIVE_ID + '/employees/csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({ csv: csv, send_invites: sendInvites }),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      var s = res.summary || {};
      var em = res.emails || {};
      var msg = '✅ ' + (s.created + s.linked + s.soft_revived) + ' processed · ' + s.created + ' new · ' + s.linked + ' linked';
      if (s.soft_revived) msg += ' · ' + s.soft_revived + ' restored';
      if (s.skipped) msg += ' · ⚠ ' + s.skipped + ' skipped';
      if (sendInvites) msg += ' · 📧 ' + em.sent + ' emailed';
      showToast(msg);
      if (s.errors && s.errors.length) {
        console.warn('CSV errors:', s.errors);
      }
      cancelCorpCsvForm();
      loadCorporateAccountDetail(CORP_ACTIVE_ID);
    })
    .catch(function(err){ showToast('❌ ' + err.message, true); });
}

function resendCorpInvite(e, btn) {
  var eid = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!eid || !CORP_ACTIVE_ID) return;
  fetch(ATP_API + '/corporate/admin/accounts/' + CORP_ACTIVE_ID + '/employees/' + eid + '/resend-invite', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      if (res.email_sent) showToast('✅ Invitation re-sent');
      else {
        showToast('⚠ Email not sent — invite URL copied to clipboard');
        try { navigator.clipboard.writeText(res.invite_url); } catch (e) {}
      }
      loadCorporateAccountDetail(CORP_ACTIVE_ID);
    });
}

// ── LOGO MANAGEMENT (admin) ────────────────────────────────────
function editCorporateLogo(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!id) return;
  var wrap = document.getElementById('corpLogoEditWrap');
  if (!wrap) return;
  if (wrap.innerHTML) { wrap.innerHTML = ''; return; }
  var current = (CORP_ACTIVE_ACCOUNT && CORP_ACTIVE_ACCOUNT.logo_url) || '';
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:16px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#A8FF00;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Company logo</div>' +
      '<label class="admin-form-label">Company logo</label>' +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">' +
        // Live preview — checkered BG reveals both light and dark logos
        '<div id="corpLogoPreview" style="width:80px;height:80px;flex-shrink:0;border-radius:8px;background:linear-gradient(45deg,#1a1a1a 25%,#222 25%,#222 50%,#1a1a1a 50%,#1a1a1a 75%,#222 75%);background-size:12px 12px;border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:6px"></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:6px">' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<input class="admin-form-input" id="corpLogoInput" placeholder="Paste URL or upload" value="' + _esc(current) + '" style="flex:1" oninput="refreshCorpLogoPreview()">' +
            '<input type="file" id="corpLogoInputFile" accept="image/png,image/svg+xml,image/webp" style="display:none" onchange="atpUpload(\'corpLogoInputFile\',\'corpLogoInput\',\'image\',1);setTimeout(refreshCorpLogoPreview,800);">' +
            '<button type="button" class="admin-btn" style="font-size:11px;padding:9px 14px;white-space:nowrap" onclick="document.getElementById(\'corpLogoInputFile\').click()">📁 Upload</button>' +
          '</div>' +
          '<div style="font-size:11px;color:#666;line-height:1.5">📐 Square <strong style="color:#aaa">256 × 256&nbsp;px</strong> (1:1) · PNG or SVG with transparent BG · &lt; 100&nbsp;KB. <strong style="color:#A8FF00">Preview shows on a checkered background</strong> so both light and dark logos are visible.</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="saveCorporateLogo" data-args=\'["' + id + '"]\' style="font-size:12px">Save logo</button>' +
        (current ? '<button class="admin-btn" data-atp-call="saveCorporateLogo" data-args=\'["' + id + '","clear"]\' style="font-size:12px">Remove logo</button>' : '') +
        '<button class="admin-btn" onclick="document.getElementById(\'corpLogoEditWrap\').innerHTML=\'\'" style="font-size:12px">Cancel</button>' +
      '</div>' +
      '<div style="margin-top:8px;font-size:11px;color:#666;line-height:1.5">Updates appear in the ATP admin panel, the company-admin panel (/company), and the public buyer dashboard within seconds.</div>' +
    '</div>';
  refreshCorpLogoPreview();
}

// Refresh the live preview inside the logo editor whenever the URL field
// changes (typing, paste, or auto-fill after upload). Renders the image
// on a checkered background so logos with transparent BG (both light and
// dark variants) are visible. If the image 404s or the URL is invalid,
// shows a red "404" badge so the admin notices instantly.
function refreshCorpLogoPreview() {
  var el = document.getElementById('corpLogoPreview');
  var input = document.getElementById('corpLogoInput');
  if (!el || !input) return;
  var url = (input.value || '').trim();
  if (!url) {
    el.innerHTML = '<span style="font-size:10px;color:#666;text-align:center;line-height:1.3">No logo<br>yet</span>';
    return;
  }
  var img = new Image();
  img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
  img.onload = function() { el.innerHTML = ''; el.appendChild(img); };
  img.onerror = function() {
    el.innerHTML = '<span style="font-size:10px;color:#ef4444;font-weight:700;text-align:center;line-height:1.3">Image<br>404</span>';
  };
  img.src = url;
}

function saveCorporateLogo(e, btn) {
  var args = JSON.parse(btn.getAttribute('data-args') || '[]');
  var id = args[0], mode = args[1];
  if (!id) return;
  var url = mode === 'clear' ? null : (document.getElementById('corpLogoInput').value || '').trim();
  if (url && !/^https:\/\//i.test(url) && !/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/i.test(url) && !/^\/api\/cms\/media\//.test(url)) {
    showToast('❌ Must be https:// , data:image/…;base64, or an /api/cms/media/… upload', true); return;
  }
  fetch(ATP_API + '/corporate/admin/accounts/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({ logo_url: url }),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.error) { showToast('❌ ' + res.error, true); return; }
      showToast(mode === 'clear' ? '✅ Logo removed' : '✅ Logo updated');
      var w = document.getElementById('corpLogoEditWrap'); if (w) w.innerHTML = '';
      loadCorporateAccountDetail(id);
    })
    .catch(function(err){ showToast('❌ ' + (err.message || 'Failed'), true); });
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
