/* ════════════════════════════════════════════════════════════════
 * ATP Admin — showToast + makeAmbassador/removeAmbassador/toggleCoach (Ambassador FIX block)
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// AMBASSADOR MODULE — FIX
// ═══════════════════════════════════════════════════════════
function makeAmbassador(id) {
  if (!id) return;
  var token = getToken();
  fetch(ATP_API + '/admin/members/' + id + '/ambassador', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
    body: JSON.stringify({enabled: true})
  }).then(r => r.json()).then(function(d) {
    if (d.success || d.member || d.message) {
      showToast('✅ Ambassador activated!');
      setTimeout(function(){ loadMembersAPI(); renderAmbassadors && renderAmbassadors(); loadCoaches && loadCoaches(); }, 300);
    } else {
      showToast('❌ ' + (d.error || 'Failed'), true);
    }
  }).catch(function(e) { showToast('❌ ' + e.message, true); });
}

function removeAmbassador(id) {
  var token = getToken();
  fetch(ATP_API + '/admin/members/' + id + '/ambassador', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
    body: JSON.stringify({enabled: false})
  }).then(r => r.json()).then(function(d) {
    if (d.success || d.member || d.message) {
      showToast('✅ Ambassador removed');
      setTimeout(function(){ loadMembersAPI(); renderAmbassadors && renderAmbassadors(); loadCoachesSection && loadCoachesSection(); }, 300);
    } else {
      showToast('❌ ' + (d.error||'Failed'), true);
    }
  });
}

async function toggleCoach(id, enable) {
  var token = getToken();
  try {
    var res = await fetch(ATP_API + '/admin/members/' + id + '/coach', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({enabled: enable})
    }).then(r => r.json());
    if (res.message) {
      showToast(enable ? '🎽 Coach activated!' : '✅ Coach role removed');
      renderAmbassadors();
      loadCoachesSection && loadCoachesSection();
    } else {
      showToast('❌ ' + (res.error || 'Failed'), true);
    }
  } catch(e) {
    showToast('❌ ' + e.message, true);
  }
}

function showToast(msg, isError) {
  if (window.ATPComponents && window.ATPComponents.toast) {
    return window.ATPComponents.toast(msg, isError ? 'danger' : 'success');
  }
  var t = document.getElementById('adminToast');
  if (!t) return;
  t.textContent = msg;
  t.style.background = isError ? '#2a1010' : '#0d1a0a';
  t.style.color = isError ? '#f87171' : '#7AC231';
  t.style.display = 'block';
  setTimeout(function() { t.style.display = 'none'; }, 3000);
}

// Fix loadMembersAPI to show real data in the Members section
async function loadMembersAPI() {
  var token = getToken();
  if (!token) return;
  var q = (document.getElementById('memberSearch')||{}).value || '';
  var url = ATP_API + '/admin/members?limit=100' + (q ? '&search='+encodeURIComponent(q) : '');
  try {
    var res = await fetch(url, {headers:{'Authorization':'Bearer '+token}});
    var data = await res.json();
    if (!data.members) return;
    MEMBERS_DATA = data.members; // keep in sync with legacy
    var tbody = document.getElementById('membersTbody');
    if (!tbody) return;
    tbody.innerHTML = data.members.map(function(m) {
      var name = ((m.first_name||'')+' '+(m.last_name||'')).trim()||'Unknown';
      var ini  = ((m.first_name||'?')[0]+(m.last_name||'?')[0]).toUpperCase();
      var joined = m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-GB',{month:'short',year:'numeric'}) : '—';
      var isAmb = m.is_ambassador;
      return '<tr>'+
        '<td style="display:flex;align-items:center;gap:10px"><div class="admin-av">'+ini+'</div>'+
        '<div><div class="admin-member-name">'+name+'</div>'+
        '<div class="admin-member-email">'+m.member_number+' · '+m.email+'</div></div></td>'+
        '<td style="color:#555;font-size:12px">'+joined+'</td>'+
        '<td style="color:#fff;font-size:13px;font-weight:600">'+(m.sessions_count||0)+'</td>'+
        '<td style="font-size:13px;font-weight:700;color:#7AC231">'+(m.points_balance||0)+'</td>'+
        '<td><span class="badge '+(isAmb?'badge-green':'badge-grey')+'">'+(isAmb?'Ambassador':'Member')+'</span></td>'+
        '<td>'+
          (isAmb
            ? '<button class="admin-btn" style="font-size:11px;padding:4px 10px" onclick="removeAmbassador(this.dataset.mid)" data-mid="'+m.id+'">Remove Amb.</button>'
            : '<button class="admin-btn" style="font-size:11px;padding:4px 10px" onclick="makeAmbassador(this.dataset.mid)" data-mid="'+m.id+'">Make Amb.</button>'
          )+
        '</td></tr>';
    }).join('');
    // Update count
    var lbl = document.querySelector('#section-members .admin-section-title span');
    if (lbl) lbl.textContent = data.total.toLocaleString() + ' total';
  } catch(e) { console.warn('loadMembersAPI:', e.message); }
}

