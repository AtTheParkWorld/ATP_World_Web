/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Founder Dashboard
 * The one page Fredy checks every morning. Built to surface the
 * five questions that decide whether ATP is alive:
 *   1. Is WAM growing?
 *   2. Are we acquiring members?
 *   3. Do new members activate (book + attend)?
 *   4. Do they come back week 2, 4, 8? (cohort retention)
 *   5. Which engaged members are about to ghost? (churn-risk list)
 * ════════════════════════════════════════════════════════════════ */

function loadFounderDashboard() {
  var host = document.getElementById('founderDashboardBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:60px;text-align:center;color:#555">Loading the numbers…</div>';
  fetch(ATP_API + '/founder/dashboard', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){ renderFounderDashboard(d); })
    .catch(function(e){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#f87171">Failed to load. ' + (e && e.message ? e.message : '') + '</div>';
    });
}

function renderFounderDashboard(d) {
  if (!d) return;
  var host = document.getElementById('founderDashboardBody');
  if (!host) return;

  // ── 1. North Star ─────────────────────────────────────────────
  var ns = d.north_star || {};
  var wamNow = ns.wam_now || 0;
  var wamPrev = ns.wam_prev || 0;
  var wamDelta = wamNow - wamPrev;
  var wamPct = wamPrev > 0 ? Math.round(100 * wamDelta / wamPrev) : (wamNow > 0 ? 100 : 0);
  var wamTrendColor = wamDelta >= 0 ? '#7AC231' : '#ef4444';
  var wamArrow = wamDelta > 0 ? '↑' : (wamDelta < 0 ? '↓' : '→');

  // ── 2. Acquisition ────────────────────────────────────────────
  var acq = d.acquisition || {};
  var signupsDelta = (acq.week || 0) - (acq.prev_week || 0);
  var signupsColor = signupsDelta >= 0 ? '#7AC231' : '#ef4444';

  // ── 3. Funnel ─────────────────────────────────────────────────
  var f = d.activation_funnel || {};
  function pct(num, denom) {
    if (!denom) return '0%';
    return Math.round(100 * num / denom) + '%';
  }

  // ── 4. Cohort retention ───────────────────────────────────────
  var cohorts = d.cohort_retention || [];

  // ── 5. Top sessions / coaches / churn ─────────────────────────
  var topSessions = (d.engagement && d.engagement.top_sessions) || [];
  var topCoaches  = (d.engagement && d.engagement.top_coaches) || [];
  var churn = d.churn_risk || [];

  // ── 6. Totals ─────────────────────────────────────────────────
  var t = d.totals || {};

  // Cohort heatmap color helper — higher = greener
  function cohortColor(retained, size) {
    if (!size || retained == null) return 'rgba(255,255,255,.04)';
    var p = retained / size;
    if (p >= 0.4) return 'rgba(122,194,49,.7)';
    if (p >= 0.25) return 'rgba(122,194,49,.45)';
    if (p >= 0.15) return 'rgba(122,194,49,.25)';
    if (p >= 0.05) return 'rgba(245,158,11,.25)';
    return 'rgba(239,68,68,.20)';
  }

  function cohortCell(retained, size) {
    if (!size) return '<td style="padding:10px;text-align:center;color:#555">—</td>';
    var p = Math.round(100 * (retained || 0) / size);
    return '<td style="padding:10px;text-align:center;background:' + cohortColor(retained, size) + ';color:#fff;font-weight:700;font-family:var(--ff-display,sans-serif)">' + p + '%</td>';
  }

  // Acquisition sparkline (8 bars)
  var trend = (acq.trend_weekly || []);
  var maxSignup = Math.max.apply(null, trend.map(function(t){ return t.signups; }).concat([1]));
  var sparkBars = trend.map(function(t){
    var h = Math.round(40 * t.signups / maxSignup);
    return '<div title="' + t.week_start + ': ' + t.signups + ' signups" style="width:14px;height:' + Math.max(2, h) + 'px;background:#7AC231;border-radius:2px"></div>';
  }).join('');

  var html = '';

  // ── Big number: WAM + sub-stats ──────────────────────────────
  html +=
    '<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:16px;margin-bottom:20px">' +
      // North star — Weekly Active Members
      '<div style="background:linear-gradient(135deg,rgba(122,194,49,.14),rgba(122,194,49,.04));border:1px solid rgba(122,194,49,.32);border-radius:14px;padding:24px">' +
        '<div style="font-size:10px;color:#7AC231;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">🌟 North Star · Weekly Active Members</div>' +
        '<div style="font-family:var(--ff-display,sans-serif);font-size:56px;font-weight:900;color:#7AC231;line-height:.95">' + wamNow.toLocaleString() + '</div>' +
        '<div style="font-size:12px;color:' + wamTrendColor + ';margin-top:6px;font-weight:600">' +
          wamArrow + ' ' + Math.abs(wamDelta) + ' vs last 7d · ' + (wamPct > 0 ? '+' : '') + wamPct + '%' +
        '</div>' +
        '<div style="font-size:11px;color:#888;margin-top:10px;line-height:1.5">Members who checked in to at least one session in the last 7 days. The single number that tells you if ATP is alive.</div>' +
      '</div>' +
      // Monthly Active Members
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px">' +
        '<div style="font-size:10px;color:#888;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">Monthly Active</div>' +
        '<div style="font-family:var(--ff-display,sans-serif);font-size:36px;font-weight:900;color:#fff">' + (ns.mam_now || 0).toLocaleString() + '</div>' +
        '<div style="font-size:11px;color:#888;margin-top:6px">Checked in 30 days</div>' +
      '</div>' +
      // Lifetime active
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px">' +
        '<div style="font-size:10px;color:#888;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">Ever Active</div>' +
        '<div style="font-family:var(--ff-display,sans-serif);font-size:36px;font-weight:900;color:#fff">' + (ns.lifetime_active || 0).toLocaleString() + '</div>' +
        '<div style="font-size:11px;color:#888;margin-top:6px">Total members who ever checked in</div>' +
      '</div>' +
      // Total members
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px">' +
        '<div style="font-size:10px;color:#888;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">Total Members</div>' +
        '<div style="font-family:var(--ff-display,sans-serif);font-size:36px;font-weight:900;color:#fff">' + (t.members_total || 0).toLocaleString() + '</div>' +
        '<div style="font-size:11px;color:#888;margin-top:6px">' + (t.active_coaches_30d || 0) + ' coaches active 30d</div>' +
      '</div>' +
    '</div>';

  // ── Activation funnel + acquisition row ──────────────────────
  html +=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
      // Acquisition
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px">' +
          '<div>' +
            '<div style="font-size:10px;color:#7AC231;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">Acquisition</div>' +
            '<div style="font-family:var(--ff-display,sans-serif);font-size:36px;font-weight:900;color:#fff">' + (acq.week || 0) + '<span style="font-size:14px;color:#888;font-weight:500;font-family:inherit;letter-spacing:0;margin-left:8px">new signups · 7d</span></div>' +
            '<div style="font-size:11px;color:' + signupsColor + ';margin-top:4px;font-weight:600">' + (signupsDelta >= 0 ? '↑ +' : '↓ ') + Math.abs(signupsDelta) + ' vs prev week</div>' +
          '</div>' +
          '<div style="display:flex;gap:3px;align-items:flex-end">' + sparkBars + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;font-size:12px;color:#888;padding-top:14px;border-top:1px solid #1e1e1e">' +
          '<div><div style="font-size:18px;color:#fff;font-weight:700;font-family:var(--ff-display,sans-serif)">' + (acq.today || 0) + '</div>Today</div>' +
          '<div><div style="font-size:18px;color:#fff;font-weight:700;font-family:var(--ff-display,sans-serif)">' + (acq.week || 0) + '</div>This week</div>' +
          '<div><div style="font-size:18px;color:#fff;font-weight:700;font-family:var(--ff-display,sans-serif)">' + (acq.month || 0) + '</div>30 days</div>' +
          '<div><div style="font-size:18px;color:#fff;font-weight:700;font-family:var(--ff-display,sans-serif)">' + (acq.total || 0).toLocaleString() + '</div>All time</div>' +
        '</div>' +
      '</div>' +
      // Activation funnel
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px">' +
        '<div style="font-size:10px;color:#7AC231;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:14px">Activation funnel · last 4-week signup cohort</div>' +
        _funnelBar('Signed up', f.signed_up, f.signed_up, '#7AC231') +
        _funnelBar('Booked any session', f.booked, f.signed_up, '#7AC231') +
        _funnelBar('Attended once', f.attended_once, f.signed_up, '#f5c042') +
        _funnelBar('Attended 2+', f.attended_twice, f.signed_up, '#f5c042') +
        '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #1e1e1e;font-size:11px;color:#888;line-height:1.5">' +
          '<strong style="color:#fff">Activation rate: ' + pct(f.attended_once, f.signed_up) + '</strong> of recent signups actually showed up to a session. ' +
          '<strong style="color:#fff">Sticky rate: ' + pct(f.attended_twice, f.signed_up) + '</strong> came back for a second.' +
        '</div>' +
      '</div>' +
    '</div>';

  // ── Cohort retention heatmap ─────────────────────────────────
  html +=
    '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px;margin-bottom:20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px">' +
        '<div>' +
          '<div style="font-size:10px;color:#7AC231;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">Cohort retention</div>' +
          '<div style="font-size:14px;color:#fff;font-weight:600">% of each weekly signup cohort still showing up</div>' +
        '</div>' +
        '<div style="font-size:11px;color:#888">Greener = better retention. Reds need attention.</div>' +
      '</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="color:#888;border-bottom:1px solid #1e1e1e">' +
          '<th style="padding:10px;text-align:left;font-weight:600">Cohort week</th>' +
          '<th style="padding:10px;text-align:center;font-weight:600">Size</th>' +
          '<th style="padding:10px;text-align:center;font-weight:600">Week 1</th>' +
          '<th style="padding:10px;text-align:center;font-weight:600">Week 2</th>' +
          '<th style="padding:10px;text-align:center;font-weight:600">Week 4</th>' +
          '<th style="padding:10px;text-align:center;font-weight:600">Week 8</th>' +
        '</tr></thead><tbody>' +
        cohorts.map(function(c){
          return '<tr style="border-bottom:1px solid #1a1a1a">' +
            '<td style="padding:10px;color:#fff">' + (c.cohort_week || '') + '</td>' +
            '<td style="padding:10px;text-align:center;color:#888">' + (c.cohort_size || 0) + '</td>' +
            cohortCell(c.w1, c.cohort_size) +
            cohortCell(c.w2, c.cohort_size) +
            cohortCell(c.w4, c.cohort_size) +
            cohortCell(c.w8, c.cohort_size) +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
    '</div>';

  // ── Top sessions + top coaches ───────────────────────────────
  html +=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
      // Top sessions
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px">' +
        '<div style="font-size:10px;color:#7AC231;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:14px">Top sessions · last 30 days</div>' +
        (topSessions.length === 0
          ? '<div style="color:#555;padding:20px;text-align:center;font-size:13px">No sessions yet in this window.</div>'
          : topSessions.map(function(s){
              var fill = s.capacity ? Math.round(100 * s.attendees / s.capacity) : 0;
              return '<div style="padding:8px 0;border-bottom:1px solid #1a1a1a;display:flex;justify-content:space-between;align-items:center;gap:14px">' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="font-size:13px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(s.title || 'Untitled') + '</div>' +
                  '<div style="font-size:11px;color:#888">' + new Date(s.scheduled_at).toLocaleDateString() + ' · ' + _esc(s.session_category || '—') + '</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0">' +
                  '<div style="font-family:var(--ff-display,sans-serif);font-size:18px;font-weight:900;color:#7AC231">' + s.attendees + '</div>' +
                  '<div style="font-size:10px;color:#888">/ ' + (s.capacity || 0) + ' · ' + fill + '%</div>' +
                '</div>' +
              '</div>';
            }).join('')
        ) +
      '</div>' +
      // Top coaches
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px">' +
        '<div style="font-size:10px;color:#7AC231;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:14px">Top coaches · last 30 days</div>' +
        (topCoaches.length === 0
          ? '<div style="color:#555;padding:20px;text-align:center;font-size:13px">No coach data yet.</div>'
          : topCoaches.map(function(c){
              return '<div style="padding:8px 0;border-bottom:1px solid #1a1a1a;display:flex;justify-content:space-between;align-items:center;gap:14px">' +
                '<div style="flex:1;min-width:0">' +
                  '<div style="font-size:13px;color:#fff;font-weight:600">' + _esc((c.first_name || '') + ' ' + (c.last_name || '')) + '</div>' +
                  '<div style="font-size:11px;color:#888">' + (c.sessions_led || 0) + ' sessions led</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0">' +
                  '<div style="font-family:var(--ff-display,sans-serif);font-size:18px;font-weight:900;color:#7AC231">' + (c.total_attendees || 0) + '</div>' +
                  '<div style="font-size:10px;color:#888">total check-ins</div>' +
                '</div>' +
              '</div>';
            }).join('')
        ) +
      '</div>' +
    '</div>';

  // ── Churn risk list ──────────────────────────────────────────
  html +=
    '<div style="background:#0f0f0f;border:1px solid rgba(245,158,11,.32);border-radius:14px;padding:24px;margin-bottom:20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px">' +
        '<div>' +
          '<div style="font-size:10px;color:#f59e0b;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">⚠️ Churn risk · "almost lost"</div>' +
          '<div style="font-size:14px;color:#fff;font-weight:600">Members who showed up 2+ times in last 60 days · but no check-in for 21+ days</div>' +
        '</div>' +
        '<div style="font-size:12px;color:#888">' + churn.length + ' at risk</div>' +
      '</div>' +
      '<div style="font-size:11px;color:#888;margin-bottom:14px;line-height:1.5">These are your highest-leverage win-back targets. They committed, then ghosted. A personal message has the best chance of bringing them back.</div>' +
      (churn.length === 0
        ? '<div style="color:#555;padding:20px;text-align:center;font-size:13px">No-one in the churn-risk zone. Either great retention, or not enough data yet.</div>'
        : '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
            '<thead><tr style="color:#888;border-bottom:1px solid #1e1e1e">' +
              '<th style="padding:10px;text-align:left">Member</th>' +
              '<th style="padding:10px;text-align:left">Email</th>' +
              '<th style="padding:10px;text-align:center">Last session</th>' +
              '<th style="padding:10px;text-align:center">Days since</th>' +
              '<th style="padding:10px;text-align:center">Recent count</th>' +
              '<th style="padding:10px;text-align:center">Action</th>' +
            '</tr></thead><tbody>' +
            churn.map(function(m){
              var subject = encodeURIComponent('We miss you at ATP');
              var body = encodeURIComponent('Hi ' + (m.first_name || 'there') + ',\n\nNoticed you haven\'t been to a session in a few weeks. Everything OK? Anything we can do to make it easier to come back?\n\n— Fredy');
              return '<tr style="border-bottom:1px solid #1a1a1a">' +
                '<td style="padding:10px;color:#fff;font-weight:600">' + _esc((m.first_name || '') + ' ' + (m.last_name || '')) + '</td>' +
                '<td style="padding:10px;color:#888;font-size:11px">' + _esc(m.email || '') + '</td>' +
                '<td style="padding:10px;text-align:center;color:#888">' + (m.last_seen ? new Date(m.last_seen).toLocaleDateString() : '—') + '</td>' +
                '<td style="padding:10px;text-align:center;color:#f59e0b;font-weight:700">' + (m.days_since || 0) + 'd</td>' +
                '<td style="padding:10px;text-align:center;color:#fff;font-weight:600">' + (m.recent_count || 0) + '</td>' +
                '<td style="padding:10px;text-align:center"><a href="mailto:' + _esc(m.email || '') + '?subject=' + subject + '&body=' + body + '" style="font-size:11px;color:#7AC231;text-decoration:none;font-weight:700">✉ Win back</a></td>' +
              '</tr>';
            }).join('') +
          '</tbody></table></div>'
      ) +
    '</div>';

  // ── Member feedback survey responses (Move 2) ────────────────
  html +=
    '<div id="founderFeedbackSection" style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:14px;padding:24px;margin-bottom:20px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px">' +
        '<div>' +
          '<div style="font-size:10px;color:#7AC231;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">🎯 Move 2 · Member voice survey</div>' +
          '<div style="font-size:14px;color:#fff;font-weight:600">Share <a href="/member-feedback" target="_blank" style="color:#7AC231;text-decoration:none">atthepark.world/member-feedback</a> with the 20 members you talk to. Their answers land here.</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="admin-btn" data-atp-call="loadFeedbackSummary" style="font-size:11px;padding:6px 14px">↻ Refresh</button>' +
          '<a class="admin-btn" href="/api/member-feedback/admin/export" target="_blank" style="font-size:11px;padding:6px 14px;text-decoration:none">📥 Export CSV</a>' +
        '</div>' +
      '</div>' +
      '<div id="feedbackSummaryBody"><div style="padding:20px;color:#555;text-align:center;font-size:13px">Loading responses…</div></div>' +
    '</div>';

  // ── Footer: generated timestamp + refresh ────────────────────
  html +=
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 4px;font-size:11px;color:#555">' +
      '<span>Generated ' + new Date(d.generated_at).toLocaleString() + '</span>' +
      '<button class="admin-btn" data-atp-call="loadFounderDashboard" style="font-size:11px;padding:6px 14px">↻ Refresh</button>' +
    '</div>';

  host.innerHTML = html;

  // Fire the feedback summary load after the main render so it doesn't
  // block the dashboard paint
  setTimeout(loadFeedbackSummary, 100);
}

// ── Member feedback summary loader ──────────────────────────────
function loadFeedbackSummary() {
  var host = document.getElementById('feedbackSummaryBody');
  if (!host) return;
  Promise.all([
    fetch(ATP_API + '/member-feedback/admin/summary', { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){ return r.json(); }),
    fetch(ATP_API + '/member-feedback/admin/list?limit=15', { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){ return r.json(); }),
  ])
    .then(function(out){
      renderFeedbackSummary(out[0] || {}, (out[1] && out[1].responses) || []);
    })
    .catch(function(){
      host.innerHTML = '<div style="padding:20px;color:#f87171;text-align:center;font-size:13px">Failed to load responses. Has the migration been run?</div>';
    });
}

function renderFeedbackSummary(summary, responses) {
  var host = document.getElementById('feedbackSummaryBody');
  if (!host) return;
  var t = summary.totals || {};
  var goalProgress = Math.min(100, Math.round(100 * (t.total || 0) / 20));

  var html = '';
  // Progress bar — 20-response goal
  html +=
    '<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:10px;padding:18px;margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">' +
        '<div><div style="font-family:var(--ff-display,sans-serif);font-size:36px;font-weight:900;color:#7AC231;line-height:1">' + (t.total || 0) + '<span style="font-size:14px;color:#888;font-weight:500;font-family:inherit;margin-left:8px">/ 20 goal</span></div>' +
        '<div style="font-size:11px;color:#888;margin-top:4px">' + (t.week || 0) + ' this week · ' + (t.day || 0) + ' today · ' + (t.unique_members || 0) + ' linked to a member</div></div>' +
      '</div>' +
      '<div style="height:6px;background:#1a1a1a;border-radius:3px;overflow:hidden"><div style="height:100%;width:' + goalProgress + '%;background:#7AC231;transition:width .3s"></div></div>' +
    '</div>';

  // Empty state
  if (!t.total) {
    html +=
      '<div style="padding:30px;text-align:center;color:#555;font-size:13px;border:1px dashed #2a2a2a;border-radius:10px">' +
        'No responses yet. Share <strong style="color:#7AC231">/member-feedback</strong> with the members you talk to.' +
      '</div>';
    host.innerHTML = html;
    return;
  }

  // Aggregates row
  html +=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">' +
      // Features used (Q2)
      '<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:10px;padding:16px">' +
        '<div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px">What they use weekly</div>' +
        (summary.q2_features_used || []).slice(0, 8).map(function(f){
          var pct = t.total ? Math.round(100 * f.count / t.total) : 0;
          return '<div style="margin-bottom:6px">' +
            '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:#fff">' + _esc(f.feature) + '</span><span style="color:#888">' + f.count + ' · ' + pct + '%</span></div>' +
            '<div style="height:4px;background:#1a1a1a;border-radius:2px"><div style="height:100%;width:' + pct + '%;background:#7AC231;border-radius:2px"></div></div>' +
          '</div>';
        }).join('') +
      '</div>' +
      // Willingness to pay (Q4)
      '<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:10px;padding:16px">' +
        '<div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px">Willingness to pay per month</div>' +
        (summary.q4_willingness_to_pay || []).map(function(b){
          var pct = t.total ? Math.round(100 * b.count / t.total) : 0;
          var color = b.band === 'AED 0' ? '#ef4444' : (b.band === 'AED 1-30' ? '#f59e0b' : '#7AC231');
          return '<div style="margin-bottom:6px">' +
            '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:#fff">' + _esc(b.band) + '</span><span style="color:#888">' + b.count + ' · ' + pct + '%</span></div>' +
            '<div style="height:4px;background:#1a1a1a;border-radius:2px"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:2px"></div></div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';

  // Recent responses table — the qualitative goldmine
  html +=
    '<div style="font-size:10px;color:#888;letter-spacing:.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px">Latest responses (read every one)</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    responses.map(function(r){
      var name = (r.name || r.first_name) ? _esc((r.name || (r.first_name + ' ' + (r.last_name || '')).trim())) : 'Anonymous';
      var meta = [r.city, r.tribe, r.member_since].filter(Boolean).map(_esc).join(' · ');
      return '<details style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px">' +
        '<summary style="padding:12px 14px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:14px">' +
          '<div><strong style="color:#fff;font-weight:600;font-size:13px">' + name + '</strong>' +
            (meta ? '<span style="color:#666;font-size:11px;margin-left:10px">' + meta + '</span>' : '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            (r.q4_how_much ? '<span style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#7AC231">' + _esc(r.q4_how_much) + '</span>' : '') +
            '<span style="font-size:10px;color:#666">' + new Date(r.created_at).toLocaleDateString() + '</span>' +
          '</div>' +
        '</summary>' +
        '<div style="padding:0 14px 14px;font-size:13px;color:var(--light);line-height:1.6">' +
          (r.q1_sad_to_lose ? '<div style="padding:10px 0;border-top:1px solid #1a1a1a"><span style="color:#7AC231;font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Sad to lose</span><br>' + _esc(r.q1_sad_to_lose) + '</div>' : '') +
          (r.q2_use_weekly && r.q2_use_weekly.length ? '<div style="padding:10px 0;border-top:1px solid #1a1a1a"><span style="color:#7AC231;font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Uses weekly</span><br>' + r.q2_use_weekly.map(_esc).join(', ') + '</div>' : '') +
          (r.q3_pay_for ? '<div style="padding:10px 0;border-top:1px solid #1a1a1a"><span style="color:#7AC231;font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Would pay for</span><br>' + _esc(r.q3_pay_for) + '</div>' : '') +
          (r.q5_leave_reason ? '<div style="padding:10px 0;border-top:1px solid #1a1a1a"><span style="color:#7AC231;font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">Would leave if</span><br>' + _esc(r.q5_leave_reason) + '</div>' : '') +
        '</div>' +
      '</details>';
    }).join('') +
    '</div>';

  host.innerHTML = html;
}

// Helper — render a funnel bar
function _funnelBar(label, value, total, color) {
  var v = value || 0;
  var t = total || 1;
  var pct = Math.round(100 * v / t);
  return '<div style="margin-bottom:8px">' +
    '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span style="color:#fff;font-weight:600">' + label + '</span><span style="color:#888"><strong style="color:#fff">' + v.toLocaleString() + '</strong> · ' + pct + '%</span></div>' +
    '<div style="height:8px;background:#1a1a1a;border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:4px;transition:width .3s"></div></div>' +
  '</div>';
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
