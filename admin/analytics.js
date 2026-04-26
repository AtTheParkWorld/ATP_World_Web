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

