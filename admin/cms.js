/* ════════════════════════════════════════════════════════════════
 * ATP Admin — CMS content editor + media upload
 * Extracted from admin/main.js (Phase 3a module split).
 * Loaded as classic <script src> from admin.html in dependency order.
 * ════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════
// CMS CONTENT EDITOR
// ═══════════════════════════════════════════════════════════

// Content schema — defines what's editable on each page.
// Each field: { key, label, type: 'text'|'textarea'|'image'|'video'|'url', default, hint }
var CMS_SCHEMA = {
  index: {
    label: '🏠 Homepage',
    sections: {
      hero: {
        label: 'Hero Section',
        desc: 'The main banner at the top of the homepage',
        fields: [
          { key: 'tag',      label: 'Top Tag',           type: 'text',     default: 'Dubai · Al Ain · Muscat' },
          { key: 'headline', label: 'Headline (3 lines)', type: 'textarea', default: 'Never\nTrain\nAlone', hint: 'Use \\n for new lines' },
          { key: 'subtitle', label: 'Subtitle',          type: 'textarea', default: 'Join the UAE\'s largest free outdoor fitness community.' },
          { key: 'cta_text', label: 'Button Text',       type: 'text',     default: 'Join Free' },
          { key: 'cta_link', label: 'Button Link',       type: 'text',     default: '/sessions.html' },
          { key: 'hero_video', label: 'Hero Video URL',  type: 'video',    hint: 'Upload a video or paste a URL. Leave empty for no video.' },
          { key: 'hero_image', label: 'Hero Image (fallback)', type: 'image', hint: 'Shown when video is not available' },
        ]
      },
      stats: {
        label: 'Hero Stats',
        desc: 'Numbers displayed in the hero section',
        fields: [
          { key: 'activities_count',  label: 'Activity Types',   type: 'text', default: '19' },
          { key: 'coaches_count',     label: 'Expert Coaches',   type: 'text', default: '21' },
          { key: 'days_per_week',     label: 'Days per Week',    type: 'text', default: '7' },
          { key: 'cost',              label: 'Cost label',       type: 'text', default: 'AED 0' },
        ]
      },
      story: {
        label: 'Our Story',
        desc: 'The founder story section',
        fields: [
          { key: 'title',     label: 'Section Title',    type: 'text',     default: 'Our Story' },
          { key: 'body',      label: 'Story Body',       type: 'textarea', hint: 'Main narrative about ATP origins' },
          { key: 'founder_photo', label: 'Founders Photo', type: 'image',  hint: 'Fredy + Tatiana photo' },
        ]
      },
      member_stories: {
        label: 'Member Stories',
        desc: 'Transformation stories (3 cards)',
        fields: [
          { key: 'card1_stat',   label: 'Card 1 · Stat',   type: 'text',     default: '−9 kg' },
          { key: 'card1_name',   label: 'Card 1 · Name',   type: 'text',     default: 'Jay Ashar · Running tribe' },
          { key: 'card1_quote',  label: 'Card 1 · Quote',  type: 'textarea', default: 'From 84 kg to 75 kg in one year. Three triathlons. Two full marathons. ATP gave me my life back.' },
          { key: 'card2_stat',   label: 'Card 2 · Stat',   type: 'text',     default: 'Spartan' },
          { key: 'card2_name',   label: 'Card 2 · Name',   type: 'text',     default: 'Gwen Gaje · Better tribe' },
          { key: 'card2_quote',  label: 'Card 2 · Quote',  type: 'textarea', default: 'I joined for free yoga. Today I\'m a Spartan racer.' },
          { key: 'card3_stat',   label: 'Card 3 · Stat',   type: 'text',     default: '6×/wk' },
          { key: 'card3_name',   label: 'Card 3 · Name',   type: 'text',     default: 'Valentina · Stronger tribe' },
          { key: 'card3_quote',  label: 'Card 3 · Quote',  type: 'textarea', default: 'ATP is sport and socialising in one. Friends for life.' },
        ]
      },
      partner_pitch: {
        label: 'Partner Pitch',
        desc: 'The sponsor/brand partner section',
        fields: [
          { key: 'title',         label: 'Title',            type: 'text',     default: 'Partner with ATP' },
          { key: 'subtitle',      label: 'Subtitle',         type: 'textarea' },
          { key: 'members_count', label: 'Stat 1 — Members', type: 'text',     default: '7,000+' },
          { key: 'sessions_count', label: 'Stat 2 — Sessions/Year', type: 'text', default: '1,500+' },
          { key: 'cities_count',  label: 'Stat 3 — Cities',  type: 'text',     default: '3' },
          { key: 'years_count',   label: 'Stat 4 — Years',   type: 'text',     default: '11' },
          { key: 'cta_email',     label: 'Contact Email',    type: 'text',     default: 'partners@atthepark.world' },
        ]
      }
    }
  },
  sessions: {
    label: '📅 Sessions Page',
    sections: {
      hero: {
        label: 'Sessions Hero',
        desc: 'Header of the sessions listing page',
        fields: [
          { key: 'title',    label: 'Page Title',    type: 'text',     default: 'All Sessions' },
          { key: 'subtitle', label: 'Subtitle',      type: 'textarea', default: 'Browse and book upcoming ATP sessions across Dubai, Al Ain and Muscat.' },
        ]
      }
    }
  },
  community: {
    label: '👥 Community Page',
    sections: {
      hero: {
        label: 'Community Hero',
        desc: 'Header of the community page',
        fields: [
          { key: 'title',    label: 'Page Title',    type: 'text',     default: 'Our Community' },
          { key: 'subtitle', label: 'Subtitle',      type: 'textarea', default: 'Meet the 7,000+ members who train with us weekly.' },
        ]
      }
    }
  },
  store: {
    label: '🛍 Store Page',
    sections: {
      hero: {
        label: 'Store Hero',
        desc: 'Header of the ATP merch store',
        fields: [
          { key: 'title',    label: 'Store Title',   type: 'text',     default: 'ATP Store' },
          { key: 'subtitle', label: 'Subtitle',      type: 'textarea', default: 'Official ATP merchandise — limited drops, 100% reinvested in the community.' },
          { key: 'banner',   label: 'Top Banner Image', type: 'image' },
        ]
      }
    }
  }
};

var CMS_CURRENT_PAGE = 'index';
var CMS_CONTENT_CACHE = {};

function selectCmsPage(page) {
  CMS_CURRENT_PAGE = page;
  document.querySelectorAll('.cms-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.page === page); });
  loadContentEditor();
}

async function loadContentEditor() {
  var body = document.getElementById('cmsEditorBody');
  if (!body) return;
  body.innerHTML = '<div style="text-align:center;color:#444;padding:40px">Loading ' + CMS_CURRENT_PAGE + '...</div>';

  // Special case: Media Library
  if (CMS_CURRENT_PAGE === '_media') {
    return loadMediaLibrary();
  }

  try {
    var token = getToken();
    var data = await fetch(ATP_API + '/cms/' + CMS_CURRENT_PAGE, {
      headers: {'Authorization':'Bearer '+token}
    }).then(r => r.json());
    CMS_CONTENT_CACHE[CMS_CURRENT_PAGE] = data.content || {};
    renderCmsEditor();
  } catch(e) {
    body.innerHTML = '<div style="text-align:center;color:#f87171;padding:40px">Error: ' + e.message + '</div>';
  }
}

function renderCmsEditor() {
  var page = CMS_CURRENT_PAGE;
  var schema = CMS_SCHEMA[page];
  var current = CMS_CONTENT_CACHE[page] || {};
  if (!schema) {
    document.getElementById('cmsEditorBody').innerHTML = '<div style="color:#555;padding:40px;text-align:center">No schema defined for this page yet.</div>';
    return;
  }

  var html = '';
  Object.keys(schema.sections).forEach(function(sectionKey) {
    var section = schema.sections[sectionKey];
    var sectionData = current[sectionKey] || {};
    html += '<div class="cms-field-group">' +
      '<div class="cms-field-group-title">' + section.label + '</div>' +
      (section.desc ? '<div class="cms-field-group-desc">' + section.desc + '</div>' : '');

    section.fields.forEach(function(field) {
      var current_val = sectionData[field.key] != null ? sectionData[field.key] : (field.default || '');
      var fieldId = 'cms_' + page + '_' + sectionKey + '_' + field.key;
      html += '<div class="cms-field">';
      html += '<label>' + field.label + '</label>';
      if (field.type === 'textarea') {
        html += '<textarea id="' + fieldId + '" data-section="' + sectionKey + '" data-key="' + field.key + '" data-type="' + field.type + '">' + String(current_val).replace(/</g,'&lt;') + '</textarea>';
      } else if (field.type === 'image' || field.type === 'video') {
        html += '<div style="display:flex;gap:8px;align-items:start">';
        html += '<input type="text" id="' + fieldId + '" data-section="' + sectionKey + '" data-key="' + field.key + '" data-type="' + field.type + '" value="' + String(current_val).replace(/"/g,'&quot;') + '" placeholder="URL or data:image/... or click Upload" style="flex:1">';
        html += '<button class="admin-btn" style="font-size:11px;padding:8px 14px;white-space:nowrap" onclick="openCmsUpload(\'' + fieldId + '\',\'' + field.type + '\')">📁 Upload</button>';
        html += '</div>';
        if (current_val && String(current_val).length > 10) {
          if (field.type === 'image') {
            html += '<img src="' + current_val + '" class="cms-image-preview" onerror="this.style.display=\'none\'">';
          } else {
            html += '<video src="' + current_val + '" controls class="cms-image-preview" onerror="this.style.display=\'none\'"></video>';
          }
        }
      } else {
        html += '<input type="text" id="' + fieldId + '" data-section="' + sectionKey + '" data-key="' + field.key + '" data-type="' + field.type + '" value="' + String(current_val).replace(/"/g,'&quot;') + '">';
      }
      if (field.hint) html += '<div style="font-size:10px;color:#444;margin-top:4px">' + field.hint + '</div>';
      html += '</div>';
    });

    html += '</div>';
  });

  // Save bar
  html += '<div style="position:sticky;bottom:0;background:#0a0a0a;padding:16px 0;border-top:1px solid #1a1a1a;display:flex;gap:10px;align-items:center;z-index:10">';
  html += '<button class="admin-btn admin-btn-primary" style="padding:12px 28px;font-size:13px;font-weight:800" data-atp-call="saveCmsContent">✓ Save All Changes</button>';
  html += '<button class="admin-btn" style="padding:12px 20px;font-size:13px" data-atp-call="loadContentEditor">↻ Revert</button>';
  html += '<a href="/' + (page === 'index' ? '' : page + '.html') + '" target="_blank" class="admin-btn" style="padding:12px 20px;font-size:13px;text-decoration:none">🔗 Preview Live Page</a>';
  html += '<span id="cmsSaveMsg" style="margin-left:16px;font-size:12px"></span>';
  html += '</div>';

  document.getElementById('cmsEditorBody').innerHTML = html;
}

async function saveCmsContent() {
  var msg = document.getElementById('cmsSaveMsg');
  msg.textContent = '⏳ Saving...';
  msg.style.color = '#888';

  var inputs = document.querySelectorAll('[id^="cms_' + CMS_CURRENT_PAGE + '_"]');
  var updates = [];
  inputs.forEach(function(input) {
    updates.push({
      page: CMS_CURRENT_PAGE,
      section: input.dataset.section,
      key: input.dataset.key,
      value_text: (input.dataset.type === 'text' || input.dataset.type === 'textarea') ? input.value : null,
      value_url: (input.dataset.type === 'image' || input.dataset.type === 'video' || input.dataset.type === 'url') ? input.value : null,
    });
  });

  try {
    var token = getToken();
    var res = await fetch(ATP_API + '/cms/bulk', {
      method:'PUT',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({ updates })
    });
    var d = await res.json();
    if (d.message) {
      msg.textContent = '✅ Saved — ' + updates.length + ' fields';
      msg.style.color = '#7AC231';
      setTimeout(function() { msg.textContent = ''; }, 4000);
    } else {
      throw new Error(d.error || 'Failed');
    }
  } catch(e) {
    msg.textContent = '❌ ' + e.message;
    msg.style.color = '#f87171';
  }
}

// ─── MEDIA UPLOAD ───
var _uploadTargetFieldId = null;
function openCmsUpload(fieldId, type) {
  _uploadTargetFieldId = fieldId;
  document.getElementById('mediaUploadModal').style.display = 'flex';
  document.getElementById('cmsFileInput').accept = (type === 'video' ? 'video/*' : 'image/*');
  document.getElementById('cmsFileInput').value = '';
  document.getElementById('cmsUploadPreview').innerHTML = '';
  document.getElementById('cmsUploadMsg').textContent = '';
}

async function handleCmsUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  var msg = document.getElementById('cmsUploadMsg');
  var preview = document.getElementById('cmsUploadPreview');

  if (file.size > 10 * 1024 * 1024) {
    msg.textContent = '❌ File too large (max 10MB). Consider compressing it.';
    msg.style.color = '#f87171';
    return;
  }

  msg.textContent = '⏳ Reading file...';
  msg.style.color = '#888';

  var reader = new FileReader();
  reader.onload = async function(e) {
    var dataUrl = e.target.result;
    // Show preview
    if (file.type.startsWith('image/')) {
      preview.innerHTML = '<img src="' + dataUrl + '" style="max-width:100%;max-height:200px;border-radius:8px">';
    } else if (file.type.startsWith('video/')) {
      preview.innerHTML = '<video src="' + dataUrl + '" controls style="max-width:100%;max-height:200px;border-radius:8px"></video>';
    }

    msg.textContent = '⏳ Uploading ' + Math.round(file.size/1024) + ' KB...';

    try {
      var token = getToken();
      var res = await fetch(ATP_API + '/cms/upload', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({
          data_url: dataUrl,
          filename: file.name,
          kind: file.type.startsWith('video/') ? 'video' : 'image'
        })
      });
      var d = await res.json();
      if (d.success) {
        msg.textContent = '✅ Uploaded (' + d.size_kb + ' KB)';
        msg.style.color = '#7AC231';
        // Set the URL in the target field
        if (_uploadTargetFieldId) {
          var target = document.getElementById(_uploadTargetFieldId);
          if (target) target.value = d.url;
        }
        setTimeout(function() {
          document.getElementById('mediaUploadModal').style.display = 'none';
          renderCmsEditor(); // re-render to show preview
        }, 800);
      } else {
        throw new Error(d.error || 'Upload failed');
      }
    } catch(e) {
      msg.textContent = '❌ ' + e.message;
      msg.style.color = '#f87171';
    }
  };
  reader.readAsDataURL(file);
}

async function loadMediaLibrary() {
  var body = document.getElementById('cmsEditorBody');
  try {
    var token = getToken();
    var data = await fetch(ATP_API + '/cms/media/list', {
      headers:{'Authorization':'Bearer '+token}
    }).then(r => r.json());
    var media = data.media || [];
    if (!media.length) {
      body.innerHTML = '<div style="text-align:center;color:#555;padding:60px">' +
        '<div style="font-size:48px;margin-bottom:12px;opacity:.3">🖼</div>' +
        '<div style="font-size:14px">No media uploaded yet.</div>' +
        '<div style="font-size:12px;color:#444;margin-top:6px">Upload images or videos from any editor field to see them here.</div>' +
      '</div>';
      return;
    }
    body.innerHTML = '<div style="font-size:12px;color:#888;margin-bottom:14px">' + media.length + ' files</div>' +
      '<div class="cms-media-grid">' +
      media.map(function(m) {
        var isVideo = m.kind === 'video';
        return '<div class="cms-media-card">' +
          (isVideo
            ? '<video src="' + m.url + '" muted></video>'
            : '<img src="' + m.url + '" alt="' + m.filename + '">'
          ) +
          '<button class="cms-media-copy" onclick="copyMediaUrl(this.dataset.u)" data-u="' + m.url + '">Copy URL</button>' +
          '<div class="cms-media-info">' + m.filename.substring(0,24) + '</div>' +
        '</div>';
      }).join('') +
      '</div>';
  } catch(e) {
    body.innerHTML = '<div style="text-align:center;color:#f87171;padding:40px">Error: ' + e.message + '</div>';
  }
}

function copyMediaUrl(url) {
  navigator.clipboard.writeText(url).then(function() { showToast('🔗 URL copied'); });
}

