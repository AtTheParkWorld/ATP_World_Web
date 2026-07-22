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

/* ════════════════════════════════════════════════════════════════
   v1.1 — DYNAMIC LAYER
   Scroll reveals, drop countdown, cart drawer, size quick-add hook,
   cart-count bounce.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Scroll reveals ────────────────────────────────────────── */
  if ('IntersectionObserver' in window) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(function (el) { revealObs.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('visible'); });
  }

  /* ── Drop countdown ────────────────────────────────────────── */
  document.querySelectorAll('[data-countdown]').forEach(function (root) {
    var target = new Date(root.getAttribute('data-countdown')).getTime();
    if (isNaN(target)) return;
    var cells = {
      d: root.querySelector('[data-cd-days]'),
      h: root.querySelector('[data-cd-hours]'),
      m: root.querySelector('[data-cd-mins]'),
      s: root.querySelector('[data-cd-secs]'),
    };
    function pad(n) { return String(n).padStart(2, '0'); }
    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) {
        root.classList.add('countdown--live');
        if (cells.d) cells.d.textContent = '00';
        if (cells.h) cells.h.textContent = '00';
        if (cells.m) cells.m.textContent = '00';
        if (cells.s) cells.s.textContent = '00';
        var live = root.closest('.drop-countdown') && root.closest('.drop-countdown').querySelector('[data-cd-live]');
        if (live) live.hidden = false;
        clearInterval(iv);
        return;
      }
      var d = Math.floor(diff / 86400000);
      var h = Math.floor(diff % 86400000 / 3600000);
      var m = Math.floor(diff % 3600000 / 60000);
      var s = Math.floor(diff % 60000 / 1000);
      if (cells.d) cells.d.textContent = pad(d);
      if (cells.h) cells.h.textContent = pad(h);
      if (cells.m) cells.m.textContent = pad(m);
      if (cells.s) cells.s.textContent = pad(s);
    }
    tick();
    var iv = setInterval(tick, 1000);
  });

  /* ── Cart drawer ───────────────────────────────────────────── */
  var drawerEl = document.getElementById('CartDrawer');

  function money(cents, currency) {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || 'en', {
        style: 'currency', currency: currency || 'AED', minimumFractionDigits: 0,
      }).format(cents / 100);
    } catch (e) { return (cents / 100).toFixed(2); }
  }

  function renderDrawer(cart) {
    if (!drawerEl) return;
    var itemsEl = drawerEl.querySelector('[data-drawer-items]');
    var subEl = drawerEl.querySelector('[data-drawer-subtotal]');
    var shipEl = drawerEl.querySelector('[data-free-ship]');
    if (subEl) subEl.textContent = money(cart.total_price, cart.currency);
    if (shipEl) {
      var threshold = Number(shipEl.getAttribute('data-threshold-cents')) || 25000;
      var pct = Math.min(100, Math.round(cart.total_price / threshold * 100));
      var fill = shipEl.querySelector('.free-ship-bar__fill');
      var msg = shipEl.querySelector('.free-ship-msg');
      if (fill) fill.style.width = pct + '%';
      if (msg) {
        msg.innerHTML = cart.total_price >= threshold
          ? '<strong>Free shipping unlocked ✓</strong>'
          : 'Add <strong>' + money(threshold - cart.total_price, cart.currency) + '</strong> more for free UAE shipping';
      }
    }
    if (!itemsEl) return;
    if (!cart.items.length) {
      itemsEl.innerHTML = '<div class="cart-drawer__empty">Your cart is empty.<br>The collection is waiting.</div>';
      return;
    }
    itemsEl.innerHTML = cart.items.map(function (item) {
      return '<div class="drawer-item">' +
        '<a class="drawer-item__img" href="' + item.url + '">' +
          (item.image ? '<img src="' + item.image.replace(/(\.[a-z]+)(\?|$)/, '_200x$1$2') + '" alt="" loading="lazy">' : '') +
        '</a>' +
        '<div>' +
          '<div class="drawer-item__title">' + item.product_title + '</div>' +
          (item.variant_title && item.variant_title !== 'Default Title'
            ? '<div class="drawer-item__meta">' + item.variant_title + ' · Qty ' + item.quantity + '</div>'
            : '<div class="drawer-item__meta">Qty ' + item.quantity + '</div>') +
          '<a href="#" class="drawer-item__remove" data-drawer-remove="' + item.key + '">Remove</a>' +
        '</div>' +
        '<div class="drawer-item__price">' + money(item.final_line_price, cart.currency) + '</div>' +
      '</div>';
    }).join('');
  }

  function openDrawer() {
    if (!drawerEl) return;
    fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
      renderDrawer(cart);
      drawerEl.classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }
  function closeDrawer() {
    if (!drawerEl) return;
    drawerEl.classList.remove('open');
    document.body.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    var openTrig = e.target.closest('[data-cart-open]');
    if (openTrig && drawerEl) { e.preventDefault(); openDrawer(); return; }
    if (e.target.closest('[data-drawer-close]') || e.target.classList.contains('cart-drawer__scrim')) { closeDrawer(); return; }
    var rm = e.target.closest('[data-drawer-remove]');
    if (rm) {
      e.preventDefault();
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rm.getAttribute('data-drawer-remove'), quantity: 0 }),
      }).then(function (r) { return r.json(); }).then(function (cart) {
        renderDrawer(cart);
        document.querySelectorAll('[data-cart-count]').forEach(function (el) {
          el.textContent = cart.item_count;
          el.setAttribute('data-count', String(cart.item_count));
        });
      });
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawerEl && drawerEl.classList.contains('open')) closeDrawer();
  });

  /* Open drawer after a successful add (hook into the toast pathway) —
     listen for cart-count changes triggered by base.js addToCart. */
  var lastCount = null;
  var countEl = document.querySelector('[data-cart-count]');
  if (countEl && 'MutationObserver' in window) {
    new MutationObserver(function () {
      var n = Number(countEl.textContent);
      countEl.classList.remove('bump');
      void countEl.offsetWidth; /* restart animation */
      countEl.classList.add('bump');
      if (lastCount !== null && n > lastCount && drawerEl) openDrawer();
      lastCount = n;
    }).observe(countEl, { childList: true, characterData: true, subtree: true });
    lastCount = Number(countEl.textContent);
  }
})();

/* ── Scroll parallax (v1.2) ─────────────────────────────────────
   Product + split-tile imagery drifts with the scroll position.
   rAF-throttled; skipped entirely under prefers-reduced-motion. */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var els = Array.prototype.slice.call(document.querySelectorAll('.parallax-img'));
  if (!els.length) return;
  var ticking = false;
  function update() {
    ticking = false;
    var vh = window.innerHeight;
    els.forEach(function (el) {
      var host = el.parentElement;
      if (!host) return;
      var r = host.getBoundingClientRect();
      if (r.bottom < -60 || r.top > vh + 60) return; /* off-screen */
      /* -1 (below viewport) … 0 (centred) … 1 (above viewport) */
      var progress = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      el.style.setProperty('--py', (progress * -14).toFixed(1) + 'px');
    });
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
})();
