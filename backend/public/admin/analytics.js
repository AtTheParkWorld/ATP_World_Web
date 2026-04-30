/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Analytics: KPIs, charts, period selector
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// ANALYTICS MODULE
// ═══════════════════════════════════════════════════════════

async function loadDashboardAPI() {
  // Alias - some code calls this by name; delegate to loadDashboardWidgets
  return loadDashboardWidgets();
}

async function loadDashboardWidgets() {
  try {
    var token = getToken();
    var data = await fetch(ATP_API+'/analytics/overview',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json());

    // ── KPI CARDS (top of dashboard) ──
    var m = data.members || {};
    var s = data.sessions || {};
    var statMembers = document.getElementById('stat-members');
    var statSessions = document.getElementById('stat-sessions');
    var statAmbs = document.getElementById('stat-ambassadors');
    var statAtt = document.getElementById('stat-attendance');
    if (statMembers)  statMembers.textContent  = (parseInt(m.total)||0).toLocaleString();
    if (statSessions) statSessions.textContent = (parseInt(s.this_month)||0).toLocaleString();
    if (statAmbs)     statAmbs.textContent     = (parseInt(m.ambassadors)||0).toLocaleString();
    // attendance - mock for now (need real data from sessions/attendance)
    if (statAtt && s.completed > 0) statAtt.textContent = '—';

    // ── RECENT SESSIONS ATTENDANCE ──
    // Fetch recent completed sessions with checkin counts
    try {
      var recent = await fetch(ATP_API+'/sessions?status=completed&limit=3', {headers:{'Authorization':'Bearer '+token}}).then(r=>r.json());
      var recentList = recent.sessions || [];
      // Always update the "Recent Sessions Attendance" section — real data or empty state
      var sections = document.querySelectorAll('.admin-section');
      sections.forEach(function(sec) {
        var title = sec.querySelector('.admin-section-title');
        if (title && title.textContent.includes('Recent Sessions Attendance')) {
          var body = sec.querySelector('.admin-section-body');
          if (body) {
            if (!recentList.length) {
              body.innerHTML = '<div style="text-align:center;color:#444;padding:28px;font-size:13px;font-style:italic">No completed sessions yet. Completed sessions will appear here with attendance stats.</div>';
            } else {
              body.innerHTML = recentList.map(function(ss) {
                var dt = ss.scheduled_at ? new Date(ss.scheduled_at).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'}) : '—';
                var att = parseInt(ss.checkins_count)||0;
                var cap = parseInt(ss.capacity)||1;
                var pct = Math.min(100, Math.round((att/cap)*100));
                return '<div style="margin-bottom:14px">'+
                  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
                    '<div><div style="font-weight:700;font-size:14px">'+ss.name+' · '+dt+'</div><div style="font-size:11px;color:#555">'+(ss.location||'')+'</div></div>'+
                    '<div style="text-align:right"><div style="font-family:var(--ff-display);font-size:18px;font-weight:900;color:#7AC231">'+att+'/'+cap+'</div><div style="font-size:10px;color:#555">checked in</div></div>'+
                  '</div>'+
                  '<div style="height:6px;background:#1a1a1a;border-radius:3px"><div style="width:'+pct+'%;height:100%;background:#7AC231;border-radius:3px"></div></div>'+
                '</div>';
              }).join('');
            }
          }
        }
      });
    } catch(e) { /* swallow */ }

    // Growth chart
    var growth = data.growth || [];
    var chart = document.getElementById('dashGrowthChart');
    if (chart) {
      if (!growth.length) {
        chart.innerHTML = '<div style="color:#333;font-size:12px;margin:auto">No data yet</div>';
      } else {
        var maxCount = Math.max.apply(null, growth.map(function(g){return g.count;})) || 1;
        chart.innerHTML = growth.map(function(g) {
          var h = Math.max(8, Math.round((g.count/maxCount)*150));
          return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">'+
            '<div style="font-size:10px;color:#7AC231;font-weight:700">'+g.count+'</div>'+
            '<div style="width:100%;background:linear-gradient(to top,#7AC231,#4a7a1d);border-radius:3px 3px 0 0;height:'+h+'px"></div>'+
            '<div style="font-size:9px;color:#444;white-space:nowrap">'+g.month+'</div>'+
          '</div>';
        }).join('');
      }
    }

    // Top members
    var top = data.top_members || [];
    var tm = document.getElementById('dashTopMembers');
    if (tm) {
      if (!top.length) {
        tm.innerHTML = '<div style="color:#333;font-size:12px">No data yet</div>';
      } else {
        var medals = ['🥇','🥈','🥉'];
        tm.innerHTML = top.slice(0,5).map(function(m,i) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #111">'+
            '<div style="width:24px;text-align:center;font-size:14px">'+(medals[i]||'#'+(i+1))+'</div>'+
            '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:#fff">'+m.first_name+' '+m.last_name+'</div><div style="font-size:11px;color:#555">'+m.member_number+(m.is_ambassador?' · Ambassador':'')+'</div></div>'+
            '<div style="font-family:var(--ff-display);font-size:16px;font-weight:900;color:#7AC231">'+m.points_balance+'</div>'+
          '</div>';
        }).join('');
      }
    }
  } catch(e) { console.warn('Dashboard widgets error:', e.message); }
}

async function loadAnalytics() {
  try {
    var token = getToken();
    var [overview, demographics] = await Promise.all([
      fetch(ATP_API+'/analytics/overview',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json()),
      fetch(ATP_API+'/analytics/members',{headers:{'Authorization':'Bearer '+token}}).then(r=>r.json()),
    ]);

    var m = overview.members || {};
    var s = overview.sessions || {};
    var ch = overview.challenges || {};

    // KPI cards
    var kpis = {
      'kpi-members':    [m.total||0, 'Total Members'],
      'kpi-new':        [m.new_this_month||0, 'New This Month'],
      'kpi-sessions':   [s.total||0, 'Total Sessions'],
      'kpi-ambassadors':[m.ambassadors||0, 'Active Coaches'],
      'kpi-points':     [(parseInt(m.total_points)||0).toLocaleString(), 'Total Points'],
      'kpi-challenges': [ch.active||0, 'Active Challenges'],
    };
    Object.entries(kpis).forEach(function([id,[val]]) {
      var el = document.getElementById(id);
      if (el) el.querySelector('.kpi-val').textContent = val;
    });

    // Growth chart
    var growth = overview.growth || [];
    var maxCount = Math.max.apply(null, growth.map(function(g){return g.count;})) || 1;
    document.getElementById('growthChart').innerHTML = growth.map(function(g) {
      var h = Math.max(8, Math.round((g.count/maxCount)*180));
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">'+
        '<div style="font-size:10px;color:#7AC231;font-weight:700">'+g.count+'</div>'+
        '<div style="width:100%;background:#7AC231;border-radius:3px 3px 0 0;transition:height .5s" style="height:'+h+'px"></div>'+
        '<div style="font-size:9px;color:#444;white-space:nowrap">'+g.month+'</div>'+
      '</div>';
    }).join('') || '<div style="color:#333;font-size:12px">No data yet</div>';

    // Fix chart heights
    growth.forEach(function(g,i) {
      var bars = document.getElementById('growthChart').children;
      if (bars[i]) {
        var bar = bars[i].children[1];
        if (bar) bar.style.height = Math.max(8, Math.round((g.count/maxCount)*180))+'px';
      }
    });

    // Top members
    var top = overview.top_members || [];
    document.getElementById('topMembersList').innerHTML = top.map(function(m,i) {
      var medals = ['🥇','🥈','🥉'];
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #111">'+
        '<div style="width:24px;text-align:center;font-size:14px">'+(medals[i]||'#'+(i+1))+'</div>'+
        '<div style="flex:1">'+
          '<div style="font-size:13px;font-weight:600;color:#fff">'+m.first_name+' '+m.last_name+'</div>'+
          '<div style="font-size:11px;color:#555">'+m.member_number+(m.is_ambassador?' · Ambassador':'')+'</div>'+
        '</div>'+
        '<div style="font-family:var(--ff-display);font-size:16px;font-weight:900;color:#7AC231">'+m.points_balance+'</div>'+
      '</div>';
    }).join('') || '<div style="color:#333;font-size:12px;padding:12px 0">No data yet</div>';

    // Nationality
    var nats = demographics.nationality || [];
    var maxNat = Math.max.apply(null, nats.map(function(n){return n.count;})) || 1;
    document.getElementById('nationalityList').innerHTML = nats.slice(0,10).map(function(n) {
      var pct = Math.round((n.count/maxNat)*100);
      return '<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">'+
          '<span style="color:#ccc">'+n.nationality+'</span>'+
          '<span style="color:#7AC231;font-weight:700">'+n.count+'</span>'+
        '</div>'+
        '<div style="height:4px;background:#1a1a1a;border-radius:2px">'+
          '<div style="width:'+pct+'%;height:100%;background:#7AC231;border-radius:2px"></div>'+
        '</div>'+
      '</div>';
    }).join('') || '<div style="color:#333;font-size:12px">No data yet</div>';

    // Session categories
    var cats = overview.activity_breakdown || [];
    var catNames = {regular:'🏃 Regular',social:'🎉 Social',team_sports:'🏆 Team Sports'};
    var maxCat = Math.max.apply(null, cats.map(function(c){return c.count;})) || 1;
    document.getElementById('sessionCategoryChart').innerHTML = cats.map(function(c) {
      var pct = Math.round((c.count/maxCat)*100);
      return '<div style="margin-bottom:12px">'+
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">'+
          '<span style="color:#ccc">'+(catNames[c.session_category]||c.session_category)+'</span>'+
          '<span style="color:#7AC231;font-weight:700">'+c.count+' sessions</span>'+
        '</div>'+
        '<div style="height:6px;background:#1a1a1a;border-radius:3px">'+
          '<div style="width:'+pct+'%;height:100%;background:#7AC231;border-radius:3px"></div>'+
        '</div>'+
      '</div>';
    }).join('') || '<div style="color:#333;font-size:12px">No sessions yet</div>';

  } catch(e) {
    console.warn('Analytics error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// ANALYTICS v2 (Theme 12) — 7 metrics + date range + exports
// ═══════════════════════════════════════════════════════════

// Default date range: last 12 months. Date inputs use YYYY-MM-DD.
function _analyticsDefaultRange() {
  var now = new Date();
  var from = new Date(now.getTime() - 365 * 86400000);
  return {
    from: from.toISOString().slice(0,10),
    to:   now.toISOString().slice(0,10),
  };
}

function setAnalyticsRange(preset) {
  var now = new Date();
  var from;
  if (preset === '30d') from = new Date(now.getTime() - 30 * 86400000);
  else if (preset === '90d') from = new Date(now.getTime() - 90 * 86400000);
  else if (preset === '12m') from = new Date(now.getTime() - 365 * 86400000);
  else if (preset === 'all') from = new Date('2020-01-01');
  else from = new Date(now.getTime() - 365 * 86400000);
  document.getElementById('analyticsFrom').value = from.toISOString().slice(0,10);
  document.getElementById('analyticsTo').value   = now.toISOString().slice(0,10);
  loadAnalyticsV2();
}

async function loadAnalyticsV2() {
  var fromInput = document.getElementById('analyticsFrom');
  var toInput   = document.getElementById('analyticsTo');
  if (!fromInput || !toInput) return;
  if (!fromInput.value || !toInput.value) {
    var def = _analyticsDefaultRange();
    fromInput.value = def.from;
    toInput.value   = def.to;
  }
  var qs = '?from=' + fromInput.value + '&to=' + toInput.value;
  var grid = document.getElementById('analyticsV2Grid');
  if (grid) grid.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:#666">Loading\u2026</div>';

  try {
    var token = getToken();
    var data = await fetch(ATP_API + '/analytics/v2' + qs, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(r){ return r.json(); });

    if (!data) throw new Error('No data');

    // ── KPI cards (range totals + active/inactive 30d) ──
    var t = data.totals || {};
    var a = data.activity || {};
    function setKPI(id, val) { var el = document.getElementById(id); if (el) { var v = el.querySelector('.kpi-val'); if (v) v.textContent = (val == null) ? '0' : Number(val).toLocaleString(); } }
    setKPI('kpi-members',  t.total_members);
    setKPI('kpi-new',      t.new_members);
    setKPI('kpi-bookings', t.bookings_in_range);
    setKPI('kpi-checkins', t.checkins_in_range);
    setKPI('kpi-active',   a.active);
    setKPI('kpi-inactive', a.inactive);

    // ── Render the 7 metric cards ──
    if (!grid) return;
    grid.innerHTML = [
      _renderGenderCard(data.gender, qs),
      _renderActivityCard(data.activity, qs),
      _renderNewPerMonthCard(data.new_per_month, qs),
      _renderSubscriptionCard(data.subscription, qs),
      _renderBookingsVsCheckinsCard(data.bookings_vs_checkins, qs),
      _renderTopSessionsCard(data.top_sessions, qs),
      _renderSessionGenderCard(data.session_gender, qs),
    ].join('');
  } catch (e) {
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:#f87171;font-size:13px">Failed to load: ' + (e.message || e) + '</div>';
    console.warn('[analytics-v2]', e);
  }
}

// Common card chrome — header, body, export buttons (CSV + Excel).
function _atpAnalyticsCard(title, metricKey, qs, body) {
  return '<div class="admin-section" style="margin-bottom:0">' +
    '<div class="admin-section-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<span class="admin-section-title">' + title + '</span>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="admin-btn" data-atp-call="exportAnalytics" data-args=\'["' + metricKey + '","csv"]\' style="font-size:11px;padding:5px 10px">⬇ CSV</button>' +
        '<button class="admin-btn" data-atp-call="exportAnalytics" data-args=\'["' + metricKey + '","xlsx"]\' style="font-size:11px;padding:5px 10px">⬇ Excel</button>' +
      '</div>' +
    '</div>' +
    '<div class="admin-section-body">' + body + '</div>' +
  '</div>';
}

// ── Card renderers ────────────────────────────────────────────────

function _renderGenderCard(rows, qs) {
  rows = rows || [];
  var total = rows.reduce(function(s, r){ return s + (Number(r.count) || 0); }, 0);
  var body = !rows.length ? _emptyCard('No member data in this range.')
    : '<div style="display:flex;flex-direction:column;gap:8px">' +
      rows.map(function(r){
        var pct = r.percent != null ? Number(r.percent).toFixed(1) : (total ? (100 * r.count / total).toFixed(1) : '0');
        return _barRow(_titleCase(r.gender || 'unspecified'), Number(r.count) || 0, pct, '#7AC231');
      }).join('') +
    '</div>';
  return _atpAnalyticsCard('🚻 Gender breakdown', 'gender', qs, body);
}

function _renderActivityCard(a, qs) {
  if (!a) return _atpAnalyticsCard('🔥 Active vs Inactive', 'activity', qs, _emptyCard('No data.'));
  var active = Number(a.active) || 0;
  var inactive = Number(a.inactive) || 0;
  var total = active + inactive;
  var body = '<div style="display:flex;gap:14px;align-items:center;justify-content:center;padding:14px 0">' +
    '<div style="text-align:center;flex:1">' +
      '<div style="font-family:var(--ff-display);font-size:36px;font-weight:900;color:#7AC231">' + active.toLocaleString() + '</div>' +
      '<div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Active</div>' +
      '<div style="font-size:11px;color:#aaa;margin-top:2px">' + (total ? Math.round(100*active/total) : 0) + '%</div>' +
    '</div>' +
    '<div style="height:60px;width:1px;background:#222"></div>' +
    '<div style="text-align:center;flex:1">' +
      '<div style="font-family:var(--ff-display);font-size:36px;font-weight:900;color:#888">' + inactive.toLocaleString() + '</div>' +
      '<div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em">Inactive</div>' +
      '<div style="font-size:11px;color:#aaa;margin-top:2px">' + (total ? Math.round(100*inactive/total) : 0) + '%</div>' +
    '</div>' +
  '</div>' +
  '<div style="font-size:11px;color:#555;text-align:center;margin-top:6px">Inactive = no check-in in last 30 days</div>';
  return _atpAnalyticsCard('🔥 Active vs Inactive', 'activity', qs, body);
}

function _renderNewPerMonthCard(rows, qs) {
  rows = rows || [];
  if (!rows.length) return _atpAnalyticsCard('📈 New members per month', 'new_per_month', qs, _emptyCard('No new sign-ups in this range.'));
  var max = rows.reduce(function(m, r){ return Math.max(m, Number(r.count)||0); }, 0);
  var body = '<div style="display:flex;gap:6px;align-items:flex-end;height:160px;padding:8px 4px;border-bottom:1px solid #1a1a1a">' +
    rows.map(function(r){
      var h = max ? Math.max(4, (Number(r.count)/max) * 140) : 4;
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:24px">' +
        '<div style="font-size:10px;font-weight:700;color:#7AC231">' + (Number(r.count)||0) + '</div>' +
        '<div title="' + r.month + ': ' + r.count + '" style="width:100%;height:' + h + 'px;background:linear-gradient(180deg,#7AC231,#3d6118);border-radius:4px 4px 0 0"></div>' +
      '</div>';
    }).join('') +
  '</div>' +
  '<div style="display:flex;gap:6px;margin-top:6px">' +
    rows.map(function(r){ return '<div style="flex:1;text-align:center;font-size:9px;color:#666;min-width:24px">' + r.month.slice(5) + '</div>'; }).join('') +
  '</div>';
  return _atpAnalyticsCard('📈 New members per month', 'new_per_month', qs, body);
}

function _renderSubscriptionCard(rows, qs) {
  rows = rows || [];
  var byTier = { free: 0, premium: 0, premium_plus: 0 };
  rows.forEach(function(r){ byTier[r.tier] = Number(r.count) || 0; });
  var total = byTier.free + byTier.premium + byTier.premium_plus;
  var body = !total ? _emptyCard('No members in this range.')
    : '<div style="display:flex;flex-direction:column;gap:10px">' +
      _barRow('🆓 Free',          byTier.free,         total ? (100*byTier.free/total).toFixed(1) : 0, '#888') +
      _barRow('⭐ Premium',        byTier.premium,      total ? (100*byTier.premium/total).toFixed(1) : 0, '#7AC231') +
      _barRow('⭐⭐ Premium+',      byTier.premium_plus, total ? (100*byTier.premium_plus/total).toFixed(1) : 0, '#ffc400') +
    '</div>';
  return _atpAnalyticsCard('💳 Subscription tier', 'subscription', qs, body);
}

function _renderBookingsVsCheckinsCard(rows, qs) {
  rows = rows || [];
  if (!rows.length) return _atpAnalyticsCard('📅 Bookings vs Check-ins (monthly)', 'bookings_vs_checkins', qs, _emptyCard('No bookings in this range.'));
  var max = rows.reduce(function(m, r){ return Math.max(m, Number(r.bookings)||0); }, 0);
  var body = '<div style="display:flex;flex-direction:column;gap:8px">' +
    rows.map(function(r){
      var bk = Number(r.bookings) || 0;
      var ck = Number(r.checkins) || 0;
      var bw = max ? (bk / max) * 100 : 0;
      var cw = max ? (ck / max) * 100 : 0;
      var pct = bk ? Math.round(100*ck/bk) : 0;
      return '<div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-bottom:3px">' +
          '<span>' + r.month + '</span>' +
          '<span><strong style="color:#fff">' + ck + '</strong> / ' + bk + ' (' + pct + '%)</span>' +
        '</div>' +
        '<div style="position:relative;height:14px;background:#0d0d0d;border-radius:3px;overflow:hidden">' +
          '<div style="position:absolute;left:0;top:0;bottom:0;width:' + bw + '%;background:#1f3a0d"></div>' +
          '<div style="position:absolute;left:0;top:0;bottom:0;width:' + cw + '%;background:#7AC231"></div>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>' +
  '<div style="display:flex;gap:14px;font-size:10px;color:#666;margin-top:10px;padding-top:10px;border-top:1px solid #1a1a1a">' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#1f3a0d;vertical-align:middle;margin-right:4px"></span>Bookings</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#7AC231;vertical-align:middle;margin-right:4px"></span>Check-ins</span>' +
  '</div>';
  return _atpAnalyticsCard('📅 Bookings vs Check-ins (monthly)', 'bookings_vs_checkins', qs, body);
}

function _renderTopSessionsCard(rows, qs) {
  rows = rows || [];
  if (!rows.length) return _atpAnalyticsCard('🏆 Sessions by check-in rate', 'top_sessions', qs, _emptyCard('No sessions in this range.'));
  var body =
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="color:#666;text-align:left;border-bottom:1px solid #1a1a1a"><th style="padding:8px 6px">Session</th><th style="padding:8px 6px;text-align:right">Bookings</th><th style="padding:8px 6px;text-align:right">Check-ins</th><th style="padding:8px 6px;text-align:right">%</th></tr></thead>' +
      '<tbody>' +
        rows.slice(0,10).map(function(r){
          var pct = r.checkin_pct != null ? Number(r.checkin_pct).toFixed(1) : '0.0';
          var color = (Number(r.checkin_pct) >= 70) ? '#7AC231' : (Number(r.checkin_pct) >= 40 ? '#ffc400' : '#f87171');
          var name = (r.name||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          return '<tr style="border-bottom:1px solid #111">' +
            '<td style="padding:8px 6px;color:#fff">' + name + '</td>' +
            '<td style="padding:8px 6px;text-align:right;color:#aaa">' + r.bookings + '</td>' +
            '<td style="padding:8px 6px;text-align:right;color:#aaa">' + r.checkins + '</td>' +
            '<td style="padding:8px 6px;text-align:right;color:' + color + ';font-weight:700">' + pct + '%</td>' +
          '</tr>';
        }).join('') +
      '</tbody>' +
    '</table>';
  return _atpAnalyticsCard('🏆 Sessions by check-in rate', 'top_sessions', qs, body);
}

function _renderSessionGenderCard(rows, qs) {
  rows = rows || [];
  if (!rows.length) return _atpAnalyticsCard('🚻 Gender breakdown per session', 'session_gender', qs, _emptyCard('No bookings in this range.'));
  // Pivot by session_id
  var bySession = {};
  rows.forEach(function(r){
    if (!bySession[r.session_id]) bySession[r.session_id] = { name: r.session_name, scheduled_at: r.scheduled_at, breakdown: {} };
    bySession[r.session_id].breakdown[r.gender || 'unspecified'] = Number(r.count) || 0;
  });
  var sessions = Object.keys(bySession).slice(0, 10).map(function(id){ return bySession[id]; });
  var body = '<div style="display:flex;flex-direction:column;gap:10px;max-height:320px;overflow-y:auto">' +
    sessions.map(function(s){
      var total = Object.values(s.breakdown).reduce(function(a,b){return a+b;}, 0);
      var name = (s.name||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var segments = '';
      var segOrder = ['male','female','non-binary','prefer_not_to_say','unspecified'];
      var colorMap = { male: '#60a5fa', female: '#f0abfc', 'non-binary': '#7AC231', prefer_not_to_say: '#888', unspecified: '#444' };
      segOrder.forEach(function(g){
        if (s.breakdown[g]) {
          var w = total ? (s.breakdown[g] / total) * 100 : 0;
          segments += '<div title="' + g + ': ' + s.breakdown[g] + '" style="width:' + w + '%;background:' + (colorMap[g]||'#666') + ';height:100%"></div>';
        }
      });
      // Any custom genders not in segOrder
      Object.keys(s.breakdown).forEach(function(g){
        if (segOrder.indexOf(g) >= 0) return;
        var w = total ? (s.breakdown[g] / total) * 100 : 0;
        segments += '<div title="' + g + ': ' + s.breakdown[g] + '" style="width:' + w + '%;background:#666;height:100%"></div>';
      });
      return '<div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">' +
          '<span style="color:#fff">' + name + '</span>' +
          '<span style="color:#666">' + total + ' booked</span>' +
        '</div>' +
        '<div style="display:flex;height:14px;border-radius:3px;overflow:hidden;background:#0d0d0d">' + segments + '</div>' +
      '</div>';
    }).join('') +
  '</div>' +
  '<div style="display:flex;gap:10px;font-size:10px;color:#666;margin-top:10px;padding-top:10px;border-top:1px solid #1a1a1a;flex-wrap:wrap">' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#60a5fa;vertical-align:middle;margin-right:4px"></span>Male</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#f0abfc;vertical-align:middle;margin-right:4px"></span>Female</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#7AC231;vertical-align:middle;margin-right:4px"></span>Non-binary</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#888;vertical-align:middle;margin-right:4px"></span>Prefer not to say</span>' +
  '</div>';
  return _atpAnalyticsCard('🚻 Gender breakdown per session', 'session_gender', qs, body);
}

// ── Helpers ──────────────────────────────────────────────────────
function _barRow(label, count, percent, color) {
  return '<div>' +
    '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">' +
      '<span style="color:#fff">' + label + '</span>' +
      '<span style="color:#aaa"><strong style="color:#fff">' + count + '</strong> · ' + percent + '%</span>' +
    '</div>' +
    '<div style="height:8px;background:#0d0d0d;border-radius:4px;overflow:hidden">' +
      '<div style="width:' + percent + '%;height:100%;background:' + color + ';transition:width .4s ease"></div>' +
    '</div>' +
  '</div>';
}

function _titleCase(s) {
  if (!s) return '';
  return String(s).split(/[_\s-]+/).map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(' ');
}

function _emptyCard(msg) {
  return '<div style="padding:30px;text-align:center;color:#666;font-size:12px">' + msg + '</div>';
}

// ── Exports ──────────────────────────────────────────────────────
// Triggers a download by opening a temporary anchor with the auth
// token in the URL — Express routes accept Bearer header OR a
// ?token= query param? They accept Bearer. We can't set headers on a
// regular link click, so we fetch as blob and trigger download.
async function _downloadAuthed(url, suggestedName) {
  try {
    var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + getToken() } });
    if (!res.ok) {
      var err = await res.json().catch(function(){ return {error:'Download failed'}; });
      showToast('❌ ' + (err.error || 'Export failed'), true);
      return;
    }
    var blob = await res.blob();
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(blobUrl); a.remove(); }, 200);
    showToast('✅ Downloaded ' + suggestedName);
  } catch (e) {
    showToast('❌ ' + e.message, true);
  }
}

function exportAnalytics(metric, format) {
  var fromInput = document.getElementById('analyticsFrom');
  var toInput   = document.getElementById('analyticsTo');
  var qs = '?format=' + (format || 'csv');
  if (fromInput && fromInput.value) qs += '&from=' + fromInput.value;
  if (toInput   && toInput.value)   qs += '&to=' + toInput.value;
  var ext = (format === 'xlsx' || format === 'excel' || format === 'xls') ? 'xls' : 'csv';
  var name = metric + '-' + (toInput ? toInput.value : 'export') + '.' + ext;
  _downloadAuthed(ATP_API + '/analytics/v2/' + metric + '/export' + qs, name);
}

function exportMembers(format) {
  var qs = '?format=' + (format || 'csv');
  // Members export ignores the date range by default (full dump). Pass
  // ?range=1 from a date-restricted button to honour the picker.
  var ext = (format === 'xlsx' || format === 'excel' || format === 'xls') ? 'xls' : 'csv';
  var name = 'atp-members-' + new Date().toISOString().slice(0,10) + '.' + ext;
  _downloadAuthed(ATP_API + '/analytics/members/export' + qs, name);
}

