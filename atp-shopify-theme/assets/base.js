/* ════════════════════════════════════════════════════════════════
   ATP STORE — base.js
   Vanilla JS. No dependencies.
   Owns: mobile drawer, cart add/count, quantity steppers, product
   gallery, variant selection, tabs, filters, newsletter, toast.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Toast ─────────────────────────────────────────────────── */
  let toastEl = null;
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ── Mobile drawer ─────────────────────────────────────────── */
  const drawer = document.getElementById('MobileDrawer');
  document.addEventListener('click', function (e) {
    const openBtn = e.target.closest('[data-drawer-open]');
    const closeBtn = e.target.closest('[data-drawer-close]');
    if (openBtn && drawer) {
      drawer.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    if ((closeBtn || e.target.classList.contains('mobile-drawer__scrim')) && drawer) {
      drawer.classList.remove('open');
      document.body.style.overflow = '';
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      document.body.style.overflow = '';
    }
  });

  /* ── Cart count ────────────────────────────────────────────── */
  function setCartCount(n) {
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.setAttribute('data-count', String(n));
    });
    const live = document.getElementById('CartLiveRegion');
    if (live) live.textContent = n + ' items in cart';
  }
  function refreshCartCount() {
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) { setCartCount(cart.item_count); })
      .catch(function () {});
  }

  /* ── Add to cart (product form + quick add) ────────────────── */
  function addToCart(variantId, qty, btn) {
    if (!variantId) { toast('Select a size first'); return; }
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Adding…'; }
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(variantId), quantity: qty || 1 }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.description || 'Could not add to cart'); });
        return r.json();
      })
      .then(function () {
        refreshCartCount();
        toast('Added to cart ✓');
      })
      .catch(function (err) { toast(err.message); })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
      });
  }

  document.addEventListener('click', function (e) {
    /* Quick add from product cards (single-variant products) */
    const quick = e.target.closest('[data-quick-add]');
    if (quick) {
      e.preventDefault();
      addToCart(quick.getAttribute('data-quick-add'), 1, null);
    }
    /* Main product form submit button */
    const atc = e.target.closest('[data-add-to-cart]');
    if (atc) {
      e.preventDefault();
      const form = atc.closest('[data-product-form]');
      const id = form ? form.querySelector('[name="id"]').value : null;
      const qtyInput = form ? form.querySelector('[data-qty-input]') : null;
      addToCart(id, qtyInput ? Number(qtyInput.value) : 1, atc);
    }
  });

  /* ── Quantity steppers ─────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    const step = e.target.closest('[data-qty-step]');
    if (!step) return;
    const wrap = step.closest('.qty-input');
    const input = wrap && wrap.querySelector('input');
    if (!input) return;
    const delta = Number(step.getAttribute('data-qty-step'));
    const next = Math.max(1, (Number(input.value) || 1) + delta);
    input.value = next;
    /* Cart page: changing qty updates the line */
    const line = step.closest('[data-line-item]');
    if (line) updateCartLine(line.getAttribute('data-line-item'), next);
  });

  /* ── Cart page line updates ────────────────────────────────── */
  function updateCartLine(lineKey, qty) {
    fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lineKey, quantity: qty }),
    })
      .then(function (r) { return r.json(); })
      .then(function () { window.location.reload(); })
      .catch(function () { toast('Could not update cart'); });
  }
  document.addEventListener('click', function (e) {
    const rm = e.target.closest('[data-line-remove]');
    if (rm) {
      e.preventDefault();
      updateCartLine(rm.getAttribute('data-line-remove'), 0);
    }
  });

  /* ── Product gallery ───────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    const thumb = e.target.closest('[data-gallery-thumb]');
    if (!thumb) return;
    const gallery = thumb.closest('[data-gallery]');
    const main = gallery && gallery.querySelector('[data-gallery-main] img');
    if (!main) return;
    main.src = thumb.getAttribute('data-gallery-thumb');
    main.srcset = '';
    gallery.querySelectorAll('.product-gallery__thumb').forEach(function (t) { t.classList.remove('active'); });
    thumb.classList.add('active');
  });

  /* ── Variant selection (option pills → hidden variant id) ──── */
  const productForm = document.querySelector('[data-product-form]');
  if (productForm) {
    const variants = JSON.parse(productForm.getAttribute('data-variants') || '[]');
    const idInput = productForm.querySelector('[name="id"]');
    const priceEl = document.querySelector('[data-product-price]');
    const atcBtn = productForm.querySelector('[data-add-to-cart]');

    function selectedOptions() {
      const out = [];
      productForm.querySelectorAll('.option-group').forEach(function (group) {
        const sel = group.querySelector('.option-pill.selected');
        out.push(sel ? sel.getAttribute('data-value') : null);
      });
      return out;
    }
    function matchVariant() {
      const opts = selectedOptions();
      if (opts.some(function (o) { return o === null; })) return null;
      return variants.find(function (v) {
        return opts.every(function (o, i) { return v.options[i] === o; });
      }) || null;
    }
    function syncState() {
      const v = matchVariant();
      if (v) {
        idInput.value = v.id;
        if (priceEl && v.price_formatted) priceEl.innerHTML = v.price_formatted;
        if (atcBtn) {
          atcBtn.disabled = !v.available;
          atcBtn.textContent = v.available
            ? (atcBtn.getAttribute('data-label-add') || 'Add to cart')
            : (atcBtn.getAttribute('data-label-sold') || 'Sold out');
        }
      } else {
        idInput.value = '';
      }
    }
    productForm.addEventListener('click', function (e) {
      const pill = e.target.closest('.option-pill');
      if (!pill || pill.classList.contains('disabled')) return;
      const group = pill.closest('.option-group');
      group.querySelectorAll('.option-pill').forEach(function (p) { p.classList.remove('selected'); });
      pill.classList.add('selected');
      syncState();
    });
    syncState();
  }

  /* ── Tabs (product description / size guide) ───────────────── */
  document.querySelectorAll('[data-tabs]').forEach(function (tabs) {
    const btns = tabs.querySelectorAll('.tabs__btn');
    const panels = tabs.querySelectorAll('.tabs__panel');
    btns.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.setAttribute('aria-selected', 'false'); });
        panels.forEach(function (p) { p.hidden = true; });
        btn.setAttribute('aria-selected', 'true');
        panels[i].hidden = false;
      });
    });
  });

  /* ── Collection filters (native storefront filtering) ──────── */
  const filterForm = document.getElementById('CollectionFilters');
  if (filterForm) {
    filterForm.addEventListener('change', function () {
      /* Submit as GET — Shopify's filter params live in the URL */
      filterForm.submit();
    });
    const mobileToggle = document.querySelector('[data-filters-toggle]');
    if (mobileToggle) {
      mobileToggle.addEventListener('click', function () {
        filterForm.closest('.filters').classList.toggle('open');
      });
    }
  }
  /* Sort select */
  const sortSelect = document.querySelector('[data-sort-select]');
  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      const url = new URL(window.location.href);
      url.searchParams.set('sort_by', sortSelect.value);
      window.location.href = url.toString();
    });
  }

  /* ── Related products (Shopify recommendations API) ────────── */
  const related = document.querySelector('[data-related-products]');
  if (related) {
    const productId = related.getAttribute('data-product-id');
    const sectionId = related.getAttribute('data-section-id');
    fetch('/recommendations/products?product_id=' + productId + '&limit=4&section_id=' + sectionId)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const inner = doc.querySelector('[data-related-products]');
        if (inner && inner.innerHTML.trim().length) related.innerHTML = inner.innerHTML;
      })
      .catch(function () {});
  }

  /* ── Lazy autoplaying hero video (respect data saver) ──────── */
  const heroVideo = document.querySelector('.hero__media video');
  if (heroVideo && 'connection' in navigator && navigator.connection.saveData) {
    heroVideo.removeAttribute('autoplay');
    heroVideo.pause();
  }

  /* ── Boot ──────────────────────────────────────────────────── */
  refreshCartCount();
})();
