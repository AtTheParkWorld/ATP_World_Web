/* ════════════════════════════════════════════════════════════════
 * ATP Admin — Blog: list, editor, cover upload, publish toggle.
 * Phase 3a module — loaded as classic <script src> from admin.html in
 * dependency order. ATP_API + getToken() come from admin/core.js.
 * ════════════════════════════════════════════════════════════════ */

var BLOG_FILTER = 'all'; // 'all' | 'published' | 'draft'
var BLOG_EDITING = null; // current post object when editor is open

function setBlogFilter(btn, name) {
  document.querySelectorAll('.blog-filter').forEach(function (b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  BLOG_FILTER = name;
  loadBlogSection();
}

async function loadBlogSection() {
  var list = document.getElementById('blogList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:#444;padding:40px">Loading…</div>';
  try {
    var token = getToken();
    var res = await fetch(ATP_API + '/blog?drafts=1&limit=200', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await res.json();
    var posts = (data && data.posts) || [];
    if (BLOG_FILTER === 'published') posts = posts.filter(function (p) { return p.is_published; });
    if (BLOG_FILTER === 'draft')     posts = posts.filter(function (p) { return !p.is_published; });

    if (!posts.length) {
      list.innerHTML = '<div style="text-align:center;color:#555;padding:40px;background:#0d0d0d;border:1px dashed #1a1a1a;border-radius:12px">' +
        '<div style="font-size:36px;margin-bottom:10px;opacity:.4">📝</div>' +
        '<div style="font-size:14px;color:#aaa">No posts yet — click <strong style="color:#7AC231">+ New post</strong> to write the first one.</div>' +
        '</div>';
      return;
    }
    list.innerHTML = posts.map(function (p) {
      var cover = p.cover_image_url
        ? '<img src="' + escapeHtml(p.cover_image_url) + '" alt="">'
        : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#0d1a0a,#1a3e0a);display:flex;align-items:center;justify-content:center;font-size:24px;opacity:.5">📝</div>';
      var when = p.published_at
        ? new Date(p.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      var statusLabel = p.is_published ? 'Published' : 'Draft';
      var statusClass = p.is_published ? 'published' : 'draft';
      return '<div class="blog-row" onclick="openBlogEditor(\'' + escapeHtml(p.id) + '\')">' +
          '<div class="blog-row-cover">' + cover + '</div>' +
          '<div>' +
            '<div class="blog-row-title">' + escapeHtml(p.title) + '</div>' +
            '<div class="blog-row-meta">' +
              '<strong>/blog/' + escapeHtml(p.slug) + '</strong> · ' +
              escapeHtml(when) +
              (p.category ? ' · ' + escapeHtml(p.category) : '') +
              ' · ' + (p.view_count || 0) + ' views' +
            '</div>' +
          '</div>' +
          '<div class="blog-row-status ' + statusClass + '">' + statusLabel + '</div>' +
        '</div>';
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="text-align:center;color:#f87171;padding:40px">Couldn\'t load posts — ' + escapeHtml(e.message || 'unknown error') + '</div>';
  }
}

async function openBlogEditor(postId) {
  var modal = document.getElementById('blogModal');
  var titleH3 = document.getElementById('blogEditorTitle');
  var deleteBtn = document.getElementById('bp-delete');
  if (!modal) return;
  modal.classList.add('open');

  // Reset
  ['bp-title', 'bp-excerpt', 'bp-body', 'bp-category', 'bp-slug', 'bp-tags'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('bp-published').checked = false;
  _renderBlogCover('');
  document.getElementById('bp-msg').textContent = '';

  if (!postId) {
    titleH3.textContent = 'New post';
    if (deleteBtn) deleteBtn.style.display = 'none';
    BLOG_EDITING = null;
    return;
  }

  // Editing — fetch the post
  titleH3.textContent = 'Loading…';
  try {
    var token = getToken();
    // The single-post endpoint is by slug; we have id, so fetch the full list and find
    var res = await fetch(ATP_API + '/blog?drafts=1&limit=200', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var data = await res.json();
    var post = (data && data.posts || []).find(function (p) { return p.id === postId; });
    if (!post) {
      titleH3.textContent = 'Post not found';
      return;
    }
    BLOG_EDITING = post;
    titleH3.textContent = 'Edit: ' + post.title;
    if (deleteBtn) deleteBtn.style.display = '';

    document.getElementById('bp-title').value    = post.title || '';
    document.getElementById('bp-excerpt').value  = post.excerpt || '';
    document.getElementById('bp-body').value     = post.body || '';
    document.getElementById('bp-category').value = post.category || '';
    document.getElementById('bp-slug').value     = post.slug || '';
    document.getElementById('bp-tags').value     = (post.tags || []).join(', ');
    document.getElementById('bp-published').checked = !!post.is_published;
    _renderBlogCover(post.cover_image_url);
  } catch (e) {
    titleH3.textContent = 'Error loading post';
  }
}

function closeBlogEditor() {
  var modal = document.getElementById('blogModal');
  if (modal) modal.classList.remove('open');
  BLOG_EDITING = null;
}

function _renderBlogCover(url) {
  var tile = document.getElementById('bp-cover');
  var empty = document.getElementById('bp-cover-empty');
  if (!tile) return;
  // Clear any image
  Array.from(tile.querySelectorAll('img,video')).forEach(function (n) { n.remove(); });
  if (url) {
    var img = document.createElement('img');
    img.src = url;
    tile.insertBefore(img, tile.firstChild);
    if (empty) empty.style.display = 'none';
  } else if (empty) {
    empty.style.display = '';
  }
  tile.dataset.url = url || '';
}

function pickBlogCover() {
  var input = document.getElementById('bp-cover-file');
  if (input) { input.value = ''; input.click(); }
}

async function handleBlogCover(ev) {
  var f = ev.target.files && ev.target.files[0];
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) {
    showToast('File too large (max 10MB).', 'danger');
    return;
  }
  var tile = document.getElementById('bp-cover');
  if (tile) tile.classList.add('busy');
  var reader = new FileReader();
  reader.onload = async function () {
    try {
      var token = getToken();
      var res = await fetch(ATP_API + '/blog/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ data_url: reader.result, filename: f.name, kind: 'image' })
      });
      var d = await res.json();
      if (tile) tile.classList.remove('busy');
      if (!d || !d.success) {
        showToast((d && d.error) || 'Upload failed', 'danger');
        return;
      }
      _renderBlogCover(d.url);
    } catch (e) {
      if (tile) tile.classList.remove('busy');
      showToast('Upload failed', 'danger');
    }
  };
  reader.readAsDataURL(f);
}

async function saveBlogPost() {
  var msg = document.getElementById('bp-msg');
  msg.textContent = 'Saving…';
  msg.style.color = '#888';

  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var coverUrl = (document.getElementById('bp-cover') || {}).dataset && document.getElementById('bp-cover').dataset.url || null;
  var tagsRaw  = get('bp-tags');
  var tags = tagsRaw ? tagsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];

  var payload = {
    title:           get('bp-title'),
    excerpt:         get('bp-excerpt') || null,
    cover_image_url: coverUrl,
    body:            get('bp-body') || null,
    category:        get('bp-category') || null,
    slug:            get('bp-slug') || null,
    tags:            tags,
    is_published:    !!document.getElementById('bp-published').checked,
  };
  if (!payload.title || payload.title.length < 3) {
    msg.textContent = 'Title is required (3+ chars).';
    msg.style.color = '#fca5a5';
    return;
  }

  try {
    var token = getToken();
    var url = BLOG_EDITING
      ? ATP_API + '/blog/' + encodeURIComponent(BLOG_EDITING.id)
      : ATP_API + '/blog';
    var method = BLOG_EDITING ? 'PUT' : 'POST';
    var res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload)
    });
    var d = await res.json();
    if (!res.ok) {
      msg.textContent = (d && d.error) || 'Save failed.';
      msg.style.color = '#fca5a5';
      return;
    }
    showToast(BLOG_EDITING ? '✓ Post updated' : '✓ Post created', 'success');
    closeBlogEditor();
    loadBlogSection();
  } catch (e) {
    msg.textContent = 'Network error.';
    msg.style.color = '#fca5a5';
  }
}

async function deleteBlogPost() {
  if (!BLOG_EDITING) return;
  if (!confirm('Delete "' + BLOG_EDITING.title + '" — this cannot be undone.')) return;
  try {
    var token = getToken();
    var res = await fetch(ATP_API + '/blog/' + encodeURIComponent(BLOG_EDITING.id), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var d = await res.json();
    if (!res.ok) {
      showToast((d && d.error) || 'Delete failed', 'danger');
      return;
    }
    showToast('✓ Post deleted', 'success');
    closeBlogEditor();
    loadBlogSection();
  } catch (e) {
    showToast('Network error', 'danger');
  }
}
