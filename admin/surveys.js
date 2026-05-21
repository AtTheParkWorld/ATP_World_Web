/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Surveys (generic customizable feedback forms)
 * Replaces the hardcoded Move-2-only feedback panel from founder.js.
 * Admin can:
 *   - list all surveys + counts
 *   - create new surveys (slug + title + intro + thank-you)
 *   - edit metadata + status (draft / active / closed)
 *   - add / edit / delete / reorder questions
 *   - view responses + per-question aggregate
 *   - export CSV per survey
 * ════════════════════════════════════════════════════════════════ */

var SURVEYS_VIEW = 'list';      // 'list' | 'edit' | 'responses'
var SURVEYS_ACTIVE_ID = null;   // currently-opened survey id

function loadSurveysSection() {
  SURVEYS_VIEW = 'list';
  SURVEYS_ACTIVE_ID = null;
  renderSurveysList();
}

function renderSurveysList() {
  var host = document.getElementById('surveysBody');
  if (!host) return;
  host.innerHTML = '<div style="padding:30px;color:#555;text-align:center">Loading surveys…</div>';

  fetch(ATP_API + '/surveys/admin', { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var list = (d && d.surveys) || [];
      var html =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
          '<div style="font-size:13px;color:#888">' + list.length + ' survey' + (list.length===1?'':'s') + ' total</div>' +
          '<button class="admin-btn admin-btn-primary" data-atp-call="newSurveyForm" style="font-size:12px;padding:8px 16px">+ New survey</button>' +
        '</div>';
      html += '<div id="surveyFormWrap"></div>';
      if (!list.length) {
        html += '<div style="padding:40px;color:#555;text-align:center;font-size:13px;border:1px dashed #2a2a2a;border-radius:10px">No surveys yet. Click "+ New survey" to create your first.</div>';
      } else {
        html += list.map(function(s){
          var statusColor = s.status === 'active' ? '#7AC231' : (s.status === 'closed' ? '#666' : '#f59e0b');
          var publicUrl = '/survey/' + s.slug;
          return '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:14px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
                '<span style="font-family:var(--ff-display,sans-serif);font-size:18px;font-weight:800;color:#fff">' + _esc(s.title) + '</span>' +
                '<span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:' + statusColor + ';background:rgba(255,255,255,.05);padding:3px 8px;border-radius:4px;border:1px solid ' + statusColor + '">' + s.status + '</span>' +
              '</div>' +
              '<div style="font-size:11px;color:#666"><code style="background:#0a0a0a;padding:2px 6px;border-radius:3px;color:#7AC231">' + publicUrl + '</code> · ' + (s.question_count || 0) + ' questions · ' + (s.actual_responses || 0) + ' responses</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px">' +
              (s.actual_responses > 0
                ? '<button class="admin-btn" data-atp-call="openSurveyResponses" data-args=\'["' + s.id + '"]\' style="font-size:11px;padding:6px 12px">📊 ' + s.actual_responses + ' responses</button>'
                : '') +
              '<button class="admin-btn" data-atp-call="openSurveyEditor" data-args=\'["' + s.id + '"]\' style="font-size:11px;padding:6px 12px">Edit</button>' +
              '<a class="admin-btn" href="' + publicUrl + '" target="_blank" style="font-size:11px;padding:6px 12px;text-decoration:none">↗ View</a>' +
            '</div>' +
          '</div>';
        }).join('');
      }
      host.innerHTML = html;
    })
    .catch(function(){ host.innerHTML = '<div style="padding:30px;color:#f87171;text-align:center">Failed to load surveys. Has the migration been run?</div>'; });
}

function newSurveyForm() {
  var wrap = document.getElementById('surveyFormWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:18px;margin-bottom:14px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:16px;font-weight:800;color:#7AC231;text-transform:uppercase;margin-bottom:12px">New survey</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label" for="newSurveyTitle">Title *</label><input class="admin-form-input" type="text" id="newSurveyTitle" placeholder="Q3 2026 Member Pulse"></div>' +
        '<div><label class="admin-form-label" for="newSurveySlug">URL slug</label><input class="admin-form-input" type="text" id="newSurveySlug" placeholder="auto from title if blank"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label" for="newSurveyIntro">Intro (shown on welcome screen)</label><textarea class="admin-form-input" id="newSurveyIntro" rows="2" placeholder="Why members should fill it in (1-2 sentences)"></textarea></div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label" for="newSurveyThx">Thank-you message</label><textarea class="admin-form-input" id="newSurveyThx" rows="2" placeholder="Shown after submission"></textarea></div>' +
      '<div style="display:flex;gap:14px;margin-bottom:14px;font-size:12px;color:#aaa">' +
        '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="newSurveyName" checked> Ask for name</label>' +
        '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="newSurveyEmail" checked> Ask for email</label>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="saveNewSurvey" style="font-size:12px">Create</button>' +
        '<button class="admin-btn" data-atp-call="cancelNewSurvey" style="font-size:12px">Cancel</button>' +
      '</div>' +
    '</div>';
}

function cancelNewSurvey() { var w = document.getElementById('surveyFormWrap'); if (w) w.innerHTML = ''; }

function saveNewSurvey() {
  var title = document.getElementById('newSurveyTitle').value.trim();
  if (!title) { showToast('❌ Title required', true); return; }
  var body = {
    title: title,
    slug: document.getElementById('newSurveySlug').value.trim() || null,
    intro: document.getElementById('newSurveyIntro').value.trim() || null,
    thank_you: document.getElementById('newSurveyThx').value.trim() || null,
    collect_name: document.getElementById('newSurveyName').checked,
    collect_email: document.getElementById('newSurveyEmail').checked,
    status: 'draft',
  };
  fetch(ATP_API + '/surveys/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Survey created — add some questions');
      openSurveyEditor(null, { getAttribute: function(){ return JSON.stringify([res.survey.id]); } });
    })
    .catch(function(){ showToast('❌ Save failed', true); });
}

// ── Survey editor (questions CRUD + metadata) ──────────────────
function openSurveyEditor(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  SURVEYS_VIEW = 'edit';
  SURVEYS_ACTIVE_ID = id;
  fetch(ATP_API + '/surveys/admin/' + id, { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){ renderSurveyEditor(d.survey, d.questions || []); });
}

function renderSurveyEditor(s, questions) {
  var host = document.getElementById('surveysBody');
  if (!host) return;
  var publicUrl = '/survey/' + s.slug;

  host.innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">' +
      '<button class="admin-btn" data-atp-call="loadSurveysSection" style="font-size:11px;padding:6px 12px">← All surveys</button>' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:22px;font-weight:800;color:#fff">' + _esc(s.title) + '</div>' +
      '<code style="background:#0a0a0a;padding:3px 8px;border-radius:4px;color:#7AC231;font-size:11px">' + publicUrl + '</code>' +
    '</div>' +

    // Metadata card
    '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px;margin-bottom:14px">' +
      '<div style="font-size:10px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-bottom:12px">Survey settings</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Title</label><input class="admin-form-input" id="srvTitle" value="' + _esc(s.title) + '"></div>' +
        '<div><label class="admin-form-label">Slug</label><input class="admin-form-input" id="srvSlug" value="' + _esc(s.slug) + '"></div>' +
        '<div><label class="admin-form-label">Status</label>' +
          '<select class="admin-form-select" id="srvStatus">' +
            ['draft','active','closed'].map(function(st){ return '<option value="' + st + '"' + (st===s.status?' selected':'') + '>' + st + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label">Intro</label><textarea class="admin-form-input" id="srvIntro" rows="2">' + _esc(s.intro || '') + '</textarea></div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label">Thank-you</label><textarea class="admin-form-input" id="srvThx" rows="2">' + _esc(s.thank_you || '') + '</textarea></div>' +
      '<div style="display:flex;gap:14px;margin-bottom:12px;font-size:12px;color:#aaa;flex-wrap:wrap">' +
        '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="srvName"' + (s.collect_name ? ' checked' : '') + '> Ask for name</label>' +
        '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="srvEmail"' + (s.collect_email ? ' checked' : '') + '> Ask for email</label>' +
        '<label style="display:flex;align-items:center;gap:6px" title="Adds a Back to ATP button on the thank-you page. Turn off if the main site isn\'t public yet."><input type="checkbox" id="srvBackLink"' + (s.show_back_link !== false ? ' checked' : '') + '> Show "Back to ATP" link on thank-you</label>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="saveSurveyMetadata" data-args=\'["' + s.id + '"]\' style="font-size:12px">Save settings</button>' +
        '<button class="admin-btn" data-atp-call="deleteSurvey" data-args=\'["' + s.id + '"]\' style="font-size:12px;color:#f87171">Delete survey</button>' +
      '</div>' +
    '</div>' +

    // Questions list
    '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px;margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="font-size:10px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Questions (' + questions.length + ')</div>' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="addQuestionForm" data-args=\'["' + s.id + '"]\' style="font-size:11px;padding:6px 12px">+ Add question</button>' +
      '</div>' +
      '<div id="newQWrap"></div>' +
      '<div id="questionsList">' +
        (!questions.length
          ? '<div style="padding:30px;color:#555;text-align:center;font-size:13px;border:1px dashed #2a2a2a;border-radius:8px">No questions yet. Click "+ Add question" above.</div>'
          : questions.map(function(q, i){ return renderQuestionRow(q, i, questions.length, s.id); }).join(''))  +
      '</div>' +
    '</div>';
}

function renderQuestionRow(q, idx, total, surveyId) {
  var typeBadge = ({
    text: 'Single line',
    textarea: 'Long text',
    single_choice: 'Pick one',
    multi_choice: 'Pick many',
    rating: '★ Rating',
  })[q.question_type] || q.question_type;

  var optsHtml = '';
  if (q.question_type === 'single_choice' || q.question_type === 'multi_choice') {
    optsHtml = '<div style="font-size:11px;color:#888;margin-top:6px">Options: ' +
      (q.options || []).map(function(o){ return '<code style="background:#0a0a0a;padding:1px 6px;border-radius:3px;margin-right:4px">' + _esc(o.label || o.value) + '</code>'; }).join('') +
      '</div>';
  }
  return '<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;gap:12px">' +
    '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
        '<span style="font-size:10px;color:#7AC231;font-family:var(--ff-display,sans-serif);font-weight:800;letter-spacing:.08em">Q' + (idx+1) + '</span>' +
        '<span style="font-size:9px;background:rgba(122,194,49,.14);color:#7AC231;padding:2px 7px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + typeBadge + '</span>' +
        (q.required ? '<span style="font-size:9px;color:#ef4444;font-weight:700">REQUIRED</span>' : '') +
      '</div>' +
      '<div style="font-size:14px;color:#fff;font-weight:500">' + _esc(q.question_text) + '</div>' +
      (q.hint_text ? '<div style="font-size:11px;color:#666;margin-top:4px;font-style:italic">' + _esc(q.hint_text) + '</div>' : '') +
      optsHtml +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">' +
      (idx > 0 ? '<button class="admin-btn" data-atp-call="moveQuestion" data-args=\'["' + q.id + '","' + surveyId + '","up"]\' style="font-size:11px;padding:4px 8px">↑</button>' : '<div style="height:24px"></div>') +
      (idx < total-1 ? '<button class="admin-btn" data-atp-call="moveQuestion" data-args=\'["' + q.id + '","' + surveyId + '","down"]\' style="font-size:11px;padding:4px 8px">↓</button>' : '<div style="height:24px"></div>') +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">' +
      '<button class="admin-btn" data-atp-call="editQuestionForm" data-args=\'["' + q.id + '","' + surveyId + '"]\' style="font-size:11px;padding:4px 10px">Edit</button>' +
      '<button class="admin-btn" data-atp-call="deleteQuestion" data-args=\'["' + q.id + '","' + surveyId + '"]\' style="font-size:11px;padding:4px 10px;color:#f87171">Delete</button>' +
    '</div>' +
  '</div>';
}

function saveSurveyMetadata(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  var body = {
    title: document.getElementById('srvTitle').value.trim(),
    slug: document.getElementById('srvSlug').value.trim(),
    status: document.getElementById('srvStatus').value,
    intro: document.getElementById('srvIntro').value.trim(),
    thank_you: document.getElementById('srvThx').value.trim(),
    collect_name: document.getElementById('srvName').checked,
    collect_email: document.getElementById('srvEmail').checked,
    show_back_link: document.getElementById('srvBackLink').checked,
  };
  fetch(ATP_API + '/surveys/admin/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Saved');
    });
}

function deleteSurvey(e, btn) {
  if (!confirm('Delete this survey and ALL its responses? This cannot be undone.')) return;
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  fetch(ATP_API + '/surveys/admin/' + id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Deleted');
      loadSurveysSection();
    });
}

// ── Question form (add / edit) ──────────────────────────────────
function addQuestionForm(e, btn) {
  var surveyId = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  renderQuestionForm(null, surveyId);
}
function editQuestionForm(e, btn) {
  var args = JSON.parse(btn.getAttribute('data-args') || '[]');
  var qid = args[0], surveyId = args[1];
  // Find the question from the current rendered list — we have it in DOM
  // but cleaner: refetch survey to get all questions, find this one
  fetch(ATP_API + '/surveys/admin/' + surveyId, { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var q = (d.questions || []).find(function(x){ return x.id === qid; });
      if (q) renderQuestionForm(q, surveyId);
    });
}

function renderQuestionForm(q, surveyId) {
  var wrap = document.getElementById('newQWrap');
  if (!wrap) return;
  var isEdit = !!q;
  var opts = (q && q.options) || [];
  var optsText = opts.map(function(o){ return (o.value || '') + (o.label && o.label !== o.value ? ' | ' + o.label : ''); }).join('\n');

  wrap.innerHTML =
    '<div style="background:#0d1a0a;border:1px solid #1f3a0d;border-radius:10px;padding:18px;margin-bottom:12px">' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:14px;font-weight:800;color:#7AC231;text-transform:uppercase;margin-bottom:12px">' + (isEdit ? 'Edit question' : 'New question') + '</div>' +
      '<input type="hidden" id="qEditId" value="' + (q ? q.id : '') + '">' +
      '<input type="hidden" id="qSurveyId" value="' + surveyId + '">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="admin-form-label">Type *</label>' +
          '<select class="admin-form-select" id="qType" onchange="_toggleOptionsField()">' +
            ['text','textarea','single_choice','multi_choice','rating'].map(function(t){
              var labels = { text:'Single line', textarea:'Long text', single_choice:'Pick one (radio)', multi_choice:'Pick many (checkbox)', rating:'Star rating (1-5)' };
              return '<option value="' + t + '"' + (q && q.question_type === t ? ' selected' : '') + '>' + labels[t] + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:end;padding-bottom:6px"><label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#aaa"><input type="checkbox" id="qRequired"' + (q && q.required ? ' checked' : '') + '> Required</label></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label">Question text *</label><textarea class="admin-form-input" id="qText" rows="2" placeholder="What\'s the one thing about ATP you\'d be sad to lose?">' + _esc(q ? q.question_text : '') + '</textarea></div>' +
      '<div style="margin-bottom:10px"><label class="admin-form-label">Hint (optional, shown below question)</label><input class="admin-form-input" type="text" id="qHint" value="' + _esc(q ? (q.hint_text || '') : '') + '"></div>' +
      '<div id="qOptionsField" style="margin-bottom:14px;display:' + (q && (q.question_type === 'single_choice' || q.question_type === 'multi_choice') ? 'block' : 'none') + '">' +
        '<label class="admin-form-label">Options (one per line, format: <code>value</code> or <code>value | label</code>)</label>' +
        '<textarea class="admin-form-input" id="qOptions" rows="6" placeholder="dubai | Dubai&#10;al-ain | Al Ain&#10;muscat | Muscat" style="font-family:monospace;font-size:12px">' + _esc(optsText) + '</textarea>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="admin-btn admin-btn-primary" data-atp-call="saveQuestion" style="font-size:12px">' + (isEdit ? 'Update question' : 'Add question') + '</button>' +
        '<button class="admin-btn" data-atp-call="cancelQuestionForm" style="font-size:12px">Cancel</button>' +
      '</div>' +
    '</div>';
}

function _toggleOptionsField() {
  var type = document.getElementById('qType').value;
  var f = document.getElementById('qOptionsField');
  if (f) f.style.display = (type === 'single_choice' || type === 'multi_choice') ? 'block' : 'none';
}

function cancelQuestionForm() { var w = document.getElementById('newQWrap'); if (w) w.innerHTML = ''; }

function saveQuestion() {
  var id = document.getElementById('qEditId').value;
  var surveyId = document.getElementById('qSurveyId').value;
  var type = document.getElementById('qType').value;
  var text = document.getElementById('qText').value.trim();
  if (!text) { showToast('❌ Question text required', true); return; }
  var body = {
    question_type: type,
    question_text: text,
    hint_text: document.getElementById('qHint').value.trim(),
    required: document.getElementById('qRequired').checked,
    options: [],
  };
  if (type === 'single_choice' || type === 'multi_choice') {
    var raw = document.getElementById('qOptions').value.trim();
    body.options = raw.split('\n').map(function(line){
      var parts = line.split('|').map(function(p){ return p.trim(); });
      var value = parts[0];
      var label = parts[1] || parts[0];
      return value ? { value: value, label: label } : null;
    }).filter(Boolean);
    if (!body.options.length) { showToast('❌ Need at least one option', true); return; }
  }
  var url = id ? (ATP_API + '/surveys/admin/questions/' + id) : (ATP_API + '/surveys/admin/' + surveyId + '/questions');
  fetch(url, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify(body),
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Saved');
      cancelQuestionForm();
      // Reload editor to refresh question list
      openSurveyEditor(null, { getAttribute: function(){ return JSON.stringify([surveyId]); } });
    });
}

function deleteQuestion(e, btn) {
  if (!confirm('Delete this question? Existing responses keep their data but won\'t show this column.')) return;
  var args = JSON.parse(btn.getAttribute('data-args') || '[]');
  var qid = args[0], surveyId = args[1];
  fetch(ATP_API + '/surveys/admin/questions/' + qid, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + getToken() },
  })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res && res.error) { showToast('❌ ' + res.error, true); return; }
      showToast('✅ Deleted');
      openSurveyEditor(null, { getAttribute: function(){ return JSON.stringify([surveyId]); } });
    });
}

function moveQuestion(e, btn) {
  var args = JSON.parse(btn.getAttribute('data-args') || '[]');
  var qid = args[0], surveyId = args[1], dir = args[2];
  // Swap sort_orders with the neighbour. Easiest: refetch list, find neighbour
  fetch(ATP_API + '/surveys/admin/' + surveyId, { headers: { Authorization: 'Bearer ' + getToken() } })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var qs = d.questions || [];
      var i = qs.findIndex(function(q){ return q.id === qid; });
      var j = dir === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= qs.length) return;
      var a = qs[i].sort_order, b = qs[j].sort_order;
      Promise.all([
        fetch(ATP_API + '/surveys/admin/questions/' + qs[i].id, { method:'PATCH', headers:{'Content-Type':'application/json',Authorization:'Bearer '+getToken()}, body:JSON.stringify({ sort_order: b }) }),
        fetch(ATP_API + '/surveys/admin/questions/' + qs[j].id, { method:'PATCH', headers:{'Content-Type':'application/json',Authorization:'Bearer '+getToken()}, body:JSON.stringify({ sort_order: a }) }),
      ]).then(function(){ openSurveyEditor(null, { getAttribute: function(){ return JSON.stringify([surveyId]); } }); });
    });
}

// ── Responses view ──────────────────────────────────────────────
function openSurveyResponses(e, btn) {
  var id = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  SURVEYS_VIEW = 'responses';
  SURVEYS_ACTIVE_ID = id;
  Promise.all([
    fetch(ATP_API + '/surveys/admin/' + id, { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){return r.json();}),
    fetch(ATP_API + '/surveys/admin/' + id + '/summary', { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){return r.json();}),
    fetch(ATP_API + '/surveys/admin/' + id + '/responses?limit=100', { headers: { Authorization: 'Bearer ' + getToken() } }).then(function(r){return r.json();}),
  ]).then(function(out){
    renderSurveyResponses(out[0].survey, out[0].questions || [], out[1], out[2].responses || []);
  });
}

function renderSurveyResponses(survey, questions, summary, responses) {
  var host = document.getElementById('surveysBody');
  if (!host) return;
  var t = summary.totals || {};
  var qById = {};
  questions.forEach(function(q){ qById[q.id] = q; });

  var html =
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">' +
      '<button class="admin-btn" data-atp-call="loadSurveysSection" style="font-size:11px;padding:6px 12px">← All surveys</button>' +
      '<div style="font-family:var(--ff-display,sans-serif);font-size:22px;font-weight:800;color:#fff">' + _esc(survey.title) + ' · Responses</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:14px"><div style="font-size:10px;color:#888;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Total</div><div style="font-family:var(--ff-display,sans-serif);font-size:28px;font-weight:900;color:#7AC231">' + (t.total || 0) + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:14px"><div style="font-size:10px;color:#888;letter-spacing:.1em;text-transform:uppercase;font-weight:600">This week</div><div style="font-family:var(--ff-display,sans-serif);font-size:28px;font-weight:900;color:#fff">' + (t.week || 0) + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:14px"><div style="font-size:10px;color:#888;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Today</div><div style="font-family:var(--ff-display,sans-serif);font-size:28px;font-weight:900;color:#fff">' + (t.day || 0) + '</div></div>' +
      '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:14px"><div style="font-size:10px;color:#888;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Linked members</div><div style="font-family:var(--ff-display,sans-serif);font-size:28px;font-weight:900;color:#fff">' + (t.unique_members || 0) + '</div></div>' +
    '</div>';

  // Per-question summary
  html += '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px;margin-bottom:18px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<div style="font-size:10px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Per-question summary</div>' +
      '<a class="admin-btn" href="' + ATP_API + '/surveys/admin/' + survey.id + '/export" target="_blank" style="font-size:11px;padding:6px 12px;text-decoration:none">📥 Export CSV</a>' +
    '</div>';
  (summary.per_question || []).forEach(function(p){
    html += '<div style="padding:10px 0;border-bottom:1px solid #1a1a1a">' +
      '<div style="font-size:13px;color:#fff;font-weight:600;margin-bottom:6px">' + _esc(p.question_text) + '</div>';
    if (p.type === 'single_choice' || p.type === 'multi_choice') {
      var totalCount = (p.counts || []).reduce(function(s, c){ return s + c.count; }, 0);
      (p.counts || []).forEach(function(c){
        var pct = totalCount ? Math.round(100 * c.count / totalCount) : 0;
        html += '<div style="margin-bottom:4px">' +
          '<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#aaa">' + _esc(c.value) + '</span><span style="color:#888">' + c.count + ' · ' + pct + '%</span></div>' +
          '<div style="height:3px;background:#1a1a1a;border-radius:2px"><div style="height:100%;width:' + pct + '%;background:#7AC231;border-radius:2px"></div></div>' +
        '</div>';
      });
    } else if (p.type === 'rating') {
      html += '<div style="font-size:13px;color:#aaa">Average: <strong style="color:#f5c042">' + (p.avg || 0) + ' / 5</strong> · <span style="color:#888">' + (p.responses || 0) + ' responses</span></div>';
    } else {
      html += '<div style="font-size:13px;color:#888">' + (p.responses || 0) + ' text responses</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // Individual responses
  html += '<div style="background:#0f0f0f;border:1px solid #1e1e1e;border-radius:10px;padding:18px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
      '<div style="font-size:10px;color:#7AC231;letter-spacing:.12em;text-transform:uppercase;font-weight:700">Latest responses (' + responses.length + ')</div>' +
      '<button class="admin-btn" data-atp-call="purgeSurveyResponses" data-args=\'["' + survey.id + '"]\' style="font-size:11px;padding:6px 12px;background:rgba(217,119,87,.10);color:#d97757;border:1px solid rgba(217,119,87,.3)">🧹 Purge test + anonymous</button>' +
    '</div>';
  if (!responses.length) {
    html += '<div style="padding:30px;color:#555;text-align:center;font-size:13px">No responses yet.</div>';
  } else {
    html += responses.map(function(r){
      var name = r.name || (r.first_name && (r.first_name + ' ' + (r.last_name || '')).trim()) || 'Anonymous';
      var isAnon = !r.name && !r.email && !r.member_id && !r.first_name;
      var isTest = (r.email || '').match(/@(example\.com|yopmail\.com|mailinator\.com)$|^test/i)
                || (r.name || '').match(/test/i);
      var tag = isAnon ? '<span style="background:rgba(136,136,136,.14);color:#888;font-size:9px;padding:2px 7px;border-radius:99px;margin-left:8px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">anonymous</span>'
              : isTest ? '<span style="background:rgba(217,119,87,.14);color:#d97757;font-size:9px;padding:2px 7px;border-radius:99px;margin-left:8px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">test</span>'
              : '';
      return '<details style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px;margin-bottom:6px">' +
        '<summary style="padding:12px 14px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px">' +
          '<div style="flex:1;min-width:0"><strong style="color:#fff;font-size:13px">' + _esc(name) + '</strong>' + tag + (r.email ? '<span style="color:#666;font-size:11px;margin-left:10px">' + _esc(r.email) + '</span>' : '') + '</div>' +
          '<span style="font-size:10px;color:#666">' + new Date(r.created_at).toLocaleDateString() + '</span>' +
          '<button class="admin-btn" onclick="event.stopPropagation();event.preventDefault();deleteSurveyResponse(\'' + r.id + '\',\'' + survey.id + '\')" style="font-size:10px;padding:4px 10px;background:rgba(239,68,68,.10);color:#ef4444;border:1px solid rgba(239,68,68,.3)" title="Delete this response">✕ Delete</button>' +
        '</summary>' +
        '<div style="padding:0 14px 14px;font-size:13px;line-height:1.6">' +
          questions.map(function(q){
            var a = r.answers && r.answers[q.id];
            if (a == null || a === '') return '';
            var display = Array.isArray(a) ? a.join(', ') : String(a);
            return '<div style="padding:8px 0;border-top:1px solid #1a1a1a"><div style="font-size:10px;color:#7AC231;letter-spacing:.08em;text-transform:uppercase;font-weight:700">' + _esc(q.question_text) + '</div><div style="color:var(--light);margin-top:3px">' + _esc(display) + '</div></div>';
          }).join('') +
        '</div>' +
      '</details>';
    }).join('');
  }
  html += '</div>';

  host.innerHTML = html;
}

// Delete a single response. Called directly from inline onclick (the
// button uses stopPropagation to prevent <details> toggling, which
// would also kill the data-atp-call delegation). Refreshes view on success.
function deleteSurveyResponse(responseId, surveyId) {
  if (!responseId || !surveyId) return;
  if (!confirm('Delete this response? This cannot be undone.')) return;
  fetch(ATP_API + '/surveys/admin/responses/' + responseId, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + getToken() },
  }).then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.error) throw new Error(d.error);
      showToast('✅ Response deleted');
      openSurveyResponses(null, { getAttribute: function(){ return JSON.stringify([surveyId]); } });
    })
    .catch(function(err){ showToast('❌ ' + err.message, true); });
}

// Bulk purge anonymous + test responses for this survey.
function purgeSurveyResponses(e, btn) {
  var surveyId = JSON.parse(btn.getAttribute('data-args') || '[]')[0];
  if (!surveyId) return;
  if (!confirm('Delete ALL anonymous AND test responses for this survey?\n\nAnonymous = no name, no email, no linked member.\nTest = email at example.com / yopmail.com / mailinator.com / starts with "test" / name contains "test".\n\nThis cannot be undone.')) return;
  fetch(ATP_API + '/surveys/admin/' + surveyId + '/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: JSON.stringify({ categories: ['anonymous', 'test'] }),
  }).then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.error) throw new Error(d.error);
      showToast('✅ Purged ' + (d.deleted_count || 0) + ' response' + ((d.deleted_count === 1) ? '' : 's'));
      openSurveyResponses(null, { getAttribute: function(){ return JSON.stringify([surveyId]); } });
    })
    .catch(function(err){ showToast('❌ ' + err.message, true); });
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
