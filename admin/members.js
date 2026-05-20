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
  // Single source of truth: loadMembersAPI reads the #memberSearch input
  // and renders the full 8-column row (incl. Points, Wallet + Top up
  // button). Don't duplicate the render here — it was producing a stale
  // 5-column variant without the Top up button.
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() { loadMembersAPI(); }, 350);
}

