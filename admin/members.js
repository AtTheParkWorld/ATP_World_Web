/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Members render + filter
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ── MEMBERS ───────────────────────────────────────────────────
function renderMembers(filter) {
  // Route to API version
  loadMembersAPI(filter);
  return;
  var list = MEMBERS_DATA;
  if (filter) {
    var q = filter.toLowerCase();
    list = list.filter(function(m){ return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.email.toLowerCase().includes(q); });
  }
  document.getElementById('membersTbody').innerHTML = list.map(function(m) {
    return '<tr>'+
      '<td style="display:flex;align-items:center"><div class="admin-av">'+m.name[0]+'</div><div><div class="admin-member-name">'+m.name+'</div><div class="admin-member-email">'+m.id+' · '+m.email+'</div></div></td>'+
      '<td style="color:#555;font-size:12px">'+m.joined+'</td>'+
      '<td style="color:#fff;font-size:13px;font-weight:600">'+m.sessions+'</td>'+
      '<td><span class="badge '+(m.active?'badge-green':'badge-grey')+'">'+(m.active?'Active':'Inactive')+'</span></td>'+
      '<td><button class="admin-btn" onclick="makeAmbassador(\'' + m.id + '\')">Make Ambassador</button></td>'+
    '</tr>';
  }).join('');
}

var _searchTimer = null;
function filterMembers(q) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() {
    // If logged in and search has content, hit real API
    var token = getToken();
    if (token && q && q.length > 1) {
      var url = '/api/admin/members?limit=50&search=' + encodeURIComponent(q);
      fetch(url, {headers:{'Authorization':'Bearer '+token}})
        .then(function(r){return r.json();})
        .then(function(data) {
          if (!data.members) return;
          var tbody = document.getElementById('membersTbody');
          if (!tbody) return;
          if (!data.members.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#444;padding:24px">No members found for "'+q+'"</td></tr>';
            return;
          }
          tbody.innerHTML = data.members.map(function(m) {
            var name = ((m.first_name||'')+' '+(m.last_name||'')).trim();
            var ini  = ((m.first_name||'?')[0]+(m.last_name||'?')[0]).toUpperCase();
            var joined = m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-GB',{month:'short',year:'numeric'}) : '—';
            return '<tr>'+
              '<td style="display:flex;align-items:center;gap:10px"><div class="admin-av">'+ini+'</div>'+
              '<div><div class="admin-member-name">'+name+'</div>'+
              '<div class="admin-member-email">'+m.member_number+' · '+m.email+'</div></div></td>'+
              '<td style="color:#555;font-size:12px">'+joined+'</td>'+
              '<td style="color:#fff;font-size:13px;font-weight:600">'+(m.sessions_count||0)+'</td>'+
              '<td><span class="badge '+(m.is_banned?'badge-grey':'badge-green')+'">'+(m.is_banned?'Inactive':'Active')+'</span></td>'+
              '<td><button class="admin-btn" onclick="makeAmbassador(this.dataset.mid)" data-mid="'+m.id+'">Make Ambassador</button></td>'+
              '</tr>';
          }).join('');
          var lbl = document.querySelector('.admin-section-title span');
          if (lbl) lbl.textContent = data.total.toLocaleString()+' total · showing '+data.members.length+' results';
        }).catch(function(){});
    } else if (!q || !q.length) {
      // Empty search — reload full list
      loadMembersAPI();
    } else {
      // Short query — filter local data
      renderMembers(q);
    }
  }, 350); // 350ms debounce
}

