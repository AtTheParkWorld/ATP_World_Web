/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Corporate Wellness
 * Sprint 2 surface: leads pipeline CRM + accounts management + live
 * engagement metrics per account.
 * ════════════════════════════════════════════════════════════════ */

var CORP_VIEW = 'leads';        // 'leads' | 'accounts' | 'account_detail'
var CORP_ACTIVE_ID = null;
var CORP_ACTIVE_ACCOUNT = null; // cached account object when in detail view

function loadCorporateSection() {
  renderCorporateSubtabs();
  showCorporateTab(CORP_VIEW);
}

function renderCorporateSubtabs() {
  var host = document.getElementById('corporateSubtabs');
  if (!host) return;
  host.innerHTML =
    '<button class="corp-subtab' + (CORP_VIEW === 'leads' ? ' active' : '') + '" data-atp-call="showCorporateTab" data-args=\'["leads"]\' style="padding:7px 14px;font-size:12px;font-weight:700;background:' + (CORP_VIEW === 'leads' ? 'rgba(122,194,49,.12)' : 'transparent') + ';color:' + (CORP_VIEW === 'leads' ? '#7AC231' : '#888') + ';border:1px solid ' + (CORP_VIEW === 'leads' ? 'rgba(122,194,49,.3)' : '#2a2a2a') + ';border-radius:8px;cursor:pointer">Leads pipeline</button>' +
    '<button class="corp-subtab' + (CORP_VIEW === 'accounts' ? ' active' : '') + '" data-atp-call="showCorporateTab" data-args=\'["accounts"]\' style="padding:7px 14px;font-size:12px;font-weight:700;background:' + (CORP_VIEW === 'accounts' ? 'rgba(122,194,49,.12)' : 'transparent') + ';color:' + (CORP_VIEW === 'accounts' ? '#7AC231' : '#888') + ';border:1px solid ' + (CORP_VIEW === 'accounts' ? 'rgba(122,194,49,.3)' : '#2a2a2a') + ';border-radius:8px;cursor:pointer">Active accounts</button>';
}

function showCorporateTab(tab) {
  CORP_VIEW = tab;
  renderCorporateSubtabs();
  if (tab === 'leads') loadCorporateLeads();
  else if (tab === 'accounts') loadCorporateAccounts();
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
  var stageColors = { new:'#888', qualified:'#3b82f6', pitch_sent:'#f59e0b', negotiating:'#f5c042', won:'#7AC231', lost:'#ef4444' };
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
      '<div style="background:#0f0f0f;border:1px solid rgba(122,194,49,.32);border-radius:10px;padding:18px"><div style="font-size:10px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Won (AED MRR)</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#7AC231">' + wonValue.toLocaleString() + '</div></div>' +
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
          (l.estimated_aed ? '<div style="font-size:11px;color:#7AC231;font-weight:700;margin-top:6px">AED ' + l.estimated_aed.toLocaleString() + ' MRR</div>' : '') +
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
      '<div style="font-family:var(--ff-display,sans-serif);font-size:16px;font-weight:800;color:#7AC231;text-transform:uppercase;margin-bottom:12px">New lead</div>' +
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
      '<div style="background:#0f0f0f;border:1px solid rgba(122,194,49,.32);border-radius:10px;padding:18px"><div style="font-size:10px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Total MRR</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#7AC231">AED ' + totalMRR.toLocaleString() + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px"><div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Employees enrolled</div><div style="font-family:var(--ff-display,sans-serif);font-size:32px;font-weight:900;color:#fff">' + totalEmployees + '</div></div>' +
      '<div style="display:flex;align-items:center;justify-content:center"><button class="admin-btn admin-btn-primary" data-atp-call="newCorporateAccountForm" style="font-size:13px;padding:10px 20px;white-space:nowrap">+ New account</button></div>' +
    '</div>' +
    '<div id="corpAccountFormWrap"></div>';

  if (!accounts.length) {
    html += '<div style="padding:40px;color:#555;text-align:center;border:1px dashed #2a2a2a;border-radius:10px">No corporate accounts yet. Close a lead and create one here.</div>';
  } else {
    html += accounts.map(function(a){
      var statusColor = a.status === 'active' ? '#7AC231' : (a.status === 'paused' ? '#f59e0b' : '#666');
      var inviteUrl = a.latest_token ? (origin + '/corporate/join/' + a.latest_token) : null;
      return '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px;margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">' +
          '<div style="flex:1">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
              '<span style="font-family:var(--ff-display,sans-serif);font-size:18px;font-weight:800;color:#fff">' + _esc(a.company_name) + '</span>' +
              '<span style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:' + statusColor + ';border:1px solid ' + statusColor + ';padding:2px 7px;border-radius:4px">' + a.status + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:#888">' +
              '<strong style="color:#7AC231">AED ' + (a.monthly_fee_aed || 0).toLocaleString() + '/mo</strong>' +
              ' · ' + (a.employee_count || 0) + ' / ' + (a.employee_cap || '∞') + ' employees' +
              ' · ' + (a.contact_email || 'no contact') +
            '</div>' +
            (inviteUrl ? '<div style="margin-top:10px;display:flex;gap:6px;align-items:center"><code style="background:#0a0a0a;padding:4px 10px;border-radius:4px;color:#7AC231;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + inviteUrl + '</code>' +
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
      '<div style="font-family:var(--ff-display,sans-serif);font-size:16px;font-weight:800;color:#7AC231;text-transform:uppercase;margin-bottom:12px">New corporate account</div>' +
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
      '<div style="margin-bottom:10px"><label class="admin-form-label">Company logo URL <span style="color:#666;font-weight:400">(https:// or data:image/...)</span></label><input class="admin-form-input" id="accLogoUrl" placeholder="https://acme.com/logo.png"></div>' +
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
    if (!/^https:\/\//i.test(rawLogo) && !/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/i.test(rawLogo)) {
      showToast('❌ Logo URL must start with https:// or data:image/…;base64', true); return;
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
          '<div><div style="font-size:9px;color:#888;letter-spacing:.1em;text-transform:uppercase">Active 30d (unique)</div><div style="font-family:var(--ff-display,sans-serif);font-size:22px;font-weight:900;color:#7AC231">' + (a.unique_30d || 0) + ' <span style="font-size:11px;color:#888;font-weight:500;font-family:inherit">/ ' + participation + '%</span></div></div>' +
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
  Promise.all([
    fetch(ATP_API + '/corporate/admin/accounts/' + id, { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){return r.json();}),
    fetch(ATP_API + '/corporate/admin/accounts/' + id + '/employees', { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){return r.json();}),
    fetch(ATP_API + '/corporate/admin/accounts/' + id + '/engagement', { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){return r.json();}),
  ]).then(function(out){
    CORP_ACTIVE_ACCOUNT = out[0] && out[0].account;
    renderCorporateAccountDetail(CORP_ACTIVE_ACCOUNT, (out[1] && out[1].employees) || [], out[2] || {});
  }).catch(function(){
    host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load. Migration run?</div>';
  });
}

function renderCorporateAccountDetail(a, employees, engagement) {
  var host = document.getElementById('corporateBody');
  if (!host) return;
  if (!a) { host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Account not found</div>'; return; }

  var origin = window.location.origin;
  var statusColor = a.status === 'active' ? '#7AC231' : (a.status === 'paused' ? '#f59e0b' : '#666');
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
          (a.logo_url ? '<img src="' + _esc(a.logo_url) + '" alt="logo" style="width:48px;height:48px;border-radius:8px;background:#fff;padding:4px;object-fit:contain">' : '<div style="width:48px;height:48px;border-radius:8px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-family:var(--ff-display,sans-serif);font-size:22px;color:#7AC231;font-weight:700">' + _esc((a.company_name||'?').charAt(0).toUpperCase()) + '</div>') +
          '<button title="Edit logo" data-atp-call="editCorporateLogo" data-args=\'["' + a.id + '"]\' style="position:absolute;bottom:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:#7AC231;color:#0a0a0a;border:2px solid #0a0a0a;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700;padding:0">✎</button>' +
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
      '<div style="background:#0f0f0f;border:1px solid rgba(122,194,49,.32);border-radius:8px;padding:14px"><div style="font-size:9px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Active</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#7AC231">' + activeCount + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px"><div style="font-size:9px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Active 30d (unique)</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#fff">' + (ea.unique_30d || 0) + ' <span style="font-size:11px;font-family:inherit;color:#888;font-weight:500">/ ' + participation + '%</span></div></div>' +
      '<div style="background:#0f0f0f;border:1px solid rgba(245,158,11,.32);border-radius:8px;padding:14px"><div style="font-size:9px;color:#f59e0b;letter-spacing:.12em;text-transform:uppercase;font-weight:600">Inactive (>30d)</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#f59e0b">' + inactive30 + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:8px;padding:14px"><div style="font-size:9px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600">AED MRR</div><div style="font-family:var(--ff-display,sans-serif);font-size:26px;font-weight:900;color:#fff">' + (a.monthly_fee_aed || 0).toLocaleString() + '</div></div>' +
    '</div>' +
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
        '<div style="display:grid;grid-template-columns:1fr 1.2fr 0.8fr 80px 100px 100px auto;gap:14px;padding:10px 16px;background:rgba(122,194,49,.04);font-size:10px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:700">' +
          '<div>Name</div><div>Email</div><div>Department</div><div>Status</div><div>30d</div><div>Last seen</div><div>Actions</div>' +
        '</div>' +
        employees.map(function(e){
          var name = ((e.first_name || '') + ' ' + (e.last_name || '')).trim() || '(no name)';
          var statusBadge;
          if (e.frozen_at) statusBadge = '<span style="background:rgba(245,158,11,.14);color:#f59e0b;font-size:9px;padding:3px 8px;border-radius:99px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">Frozen</span>';
          else if (e.invitation_sent_at && !e.joined_at) statusBadge = '<span style="background:rgba(59,130,246,.14);color:#3b82f6;font-size:9px;padding:3px 8px;border-radius:99px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">Invited</span>';
          else statusBadge = '<span style="background:rgba(122,194,49,.14);color:#7AC231;font-size:9px;padding:3px 8px;border-radius:99px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">Active</span>';
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
                ? '<button class="admin-btn" data-atp-call="unfreezeCorpEmployee" data-args=\'["' + e.id + '"]\' style="font-size:10px;padding:4px 8px;background:rgba(122,194,49,.10);color:#7AC231;border:1px solid rgba(122,194,49,.3)">Unfreeze</button>'
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

function newCorpEmployeeForm() {
  var wrap = document.getElementById('corpEmpFormWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:16px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#7AC231;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Add an employee</div>' +
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
      '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#7AC231;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Bulk upload from CSV</div>' +
      '<div style="font-size:12px;color:#aaa;line-height:1.55;margin-bottom:12px">' +
        'CSV must have a header row. Required column: <code style="background:#000;padding:2px 6px;border-radius:3px;color:#7AC231">email</code>. ' +
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
      '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#7AC231;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Company logo</div>' +
      '<label class="admin-form-label">Logo URL <span style="color:#666;font-weight:400">(https:// or data:image/…;base64)</span></label>' +
      '<input class="admin-form-input" id="corpLogoInput" placeholder="https://acme.com/logo.png" value="' + _esc(current) + '">' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="saveCorporateLogo" data-args=\'["' + id + '"]\' style="font-size:12px">Save logo</button>' +
        (current ? '<button class="admin-btn" data-atp-call="saveCorporateLogo" data-args=\'["' + id + '","clear"]\' style="font-size:12px">Remove logo</button>' : '') +
        '<button class="admin-btn" onclick="document.getElementById(\'corpLogoEditWrap\').innerHTML=\'\'" style="font-size:12px">Cancel</button>' +
      '</div>' +
      '<div style="margin-top:8px;font-size:11px;color:#666;line-height:1.5">Updates appear in the ATP admin panel, the company-admin panel (/company), and the public buyer dashboard within seconds.</div>' +
    '</div>';
}

function saveCorporateLogo(e, btn) {
  var args = JSON.parse(btn.getAttribute('data-args') || '[]');
  var id = args[0], mode = args[1];
  if (!id) return;
  var url = mode === 'clear' ? null : (document.getElementById('corpLogoInput').value || '').trim();
  if (url && !/^https:\/\//i.test(url) && !/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/i.test(url)) {
    showToast('❌ Must be https:// or data:image/…;base64', true); return;
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
