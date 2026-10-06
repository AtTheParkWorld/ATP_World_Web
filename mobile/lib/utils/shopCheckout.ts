/**
 * Store-tab helpers for the Shopify storefront WebView.
 *
 *  - URL tests: which hosts are Shopify's own, when the WebView is in
 *    checkout, and when an order has just been placed.
 *  - buyerIdentityScript(): a document-start script that puts the
 *    signed-in member's email (and +E.164 phone) on the Shopify cart, so
 *    checkout opens with their details filled in instead of a blank
 *    contact step and a "Sign in" prompt (founder item 4, 2026-10-06).
 *
 * The script talks to Shopify's PUBLIC Storefront API with the same
 * public token store.html has always shipped — no ATP or admin secret
 * ever reaches the page.
 */

/** Public Storefront API token (Headless channel) — public by design. */
const STOREFRONT_TOKEN = '31a1a5554b7f2fdaf2aa4dc44e13a127';
const STOREFRONT_API_PATH = '/api/2025-01/graphql.json';

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return ''; }
}

/** Shopify-run hosts the shop, checkout and Shop Pay live on. */
export function isShopifyHost(url: string): boolean {
  const h = hostOf(url);
  return (
    h.endsWith('myshopify.com') ||
    h.endsWith('shopify.com') ||
    h === 'shop.app' || h.endsWith('.shop.app') ||   // Shop Pay
    h.endsWith('shopifyinc.com') ||                  // checkout card fields (PCI iframe)
    h.endsWith('shopifycdn.com') ||
    h.endsWith('atthepark.world')
  );
}

/** Shopify checkout (any step before the thank-you page). */
export function isCheckoutUrl(url: string): boolean {
  if (!isShopifyHost(url)) return false;
  const p = pathOf(url);
  return /\/checkouts?(\/|$)/.test(p) && !isOrderCompleteUrl(url);
}

/**
 * The page Shopify lands on once an order is placed:
 *   /checkouts/cn/<token>/thank-you         (current checkout)
 *   /<shopId>/checkouts/<token>/thank_you   (older checkout)
 *   /<shopId>/orders/<token>[/authenticate] (order-status page)
 * The customer-account order list (/account/orders) is NOT a completion.
 */
export function isOrderCompleteUrl(url: string): boolean {
  if (!isShopifyHost(url)) return false;
  const p = pathOf(url);
  return /\/thank[-_]you(\/|$)/i.test(p) || /^\/\d+\/orders\/[0-9a-f]{16,}/i.test(p);
}

/** members.phone only goes to Shopify when it is already valid E.164. */
export function e164OrNull(phone: string | null | undefined): string | null {
  const p = String(phone || '').replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

/**
 * Document-start script for the storefront WebView. On shop pages (never
 * checkout, never another host) it:
 *   1. reads the theme cart (/cart.js) and, once it has items, sets
 *      cart.buyerIdentity = { email, phone? } via cartBuyerIdentityUpdate
 *      (the Ajax cart token IS the Storefront cart id);
 *   2. re-runs after every /cart/add|change|update the theme makes;
 *   3. holds the "Checkout" hand-off (form submit or /cart/checkout link)
 *      for up to 2.5s so the email is on the cart before Shopify builds
 *      the checkout.
 * Every failure is swallowed: worst case the buyer types their email,
 * exactly as before.
 */
export function buyerIdentityScript(opts: { shopHost: string; email: string; phone?: string | null }): string {
  const cfg = JSON.stringify({
    host:  opts.shopHost.toLowerCase(),
    email: opts.email.trim().toLowerCase(),
    phone: e164OrNull(opts.phone),
    token: STOREFRONT_TOKEN,
    api:   STOREFRONT_API_PATH,
  });
  return `(function () {
  try {
    var C = ${cfg};
    if (location.hostname.toLowerCase() !== C.host) return;
    if (/\\/checkouts?(\\/|$)/.test(location.pathname)) return;
    if (window.__atpBuyerIdentity) return;
    window.__atpBuyerIdentity = true;
    var origFetch = window.fetch.bind(window);
    var inflight = null;
    var MUTATION = 'mutation atpBuyer($id: ID!, $b: CartBuyerIdentityInput!) {' +
      ' cartBuyerIdentityUpdate(cartId: $id, buyerIdentity: $b) { cart { id } userErrors { field message } } }';
    function update(token, b) {
      return origFetch(C.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': C.token },
        body: JSON.stringify({ query: MUTATION, variables: { id: 'gid://shopify/Cart/' + token, b: b } })
      }).then(function (r) { return r.json(); }).then(function (j) {
        var u = j && j.data && j.data.cartBuyerIdentityUpdate;
        return !!(u && u.cart && !(u.userErrors && u.userErrors.length));
      });
    }
    function sync() {
      if (inflight) return inflight;
      inflight = origFetch('/cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          if (!cart || !cart.token || !cart.item_count) return;
          var key = 'atpBuyer:' + cart.token;
          try { if (sessionStorage.getItem(key) === C.email) return; } catch (e) {}
          var b = { email: C.email };
          if (C.phone) b.phone = C.phone;
          return update(cart.token, b)
            .then(function (ok) { return ok || !C.phone ? ok : update(cart.token, { email: C.email }); })
            .then(function (ok) { if (ok) { try { sessionStorage.setItem(key, C.email); } catch (e) {} } });
        })
        .catch(function () {})
        .then(function () { inflight = null; });
      return inflight;
    }
    window.fetch = function (input) {
      var p = origFetch.apply(window, arguments);
      try {
        var u = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\\/cart\\/(add|change|update|clear)/.test(u)) p.then(function () { setTimeout(sync, 0); }, function () {});
      } catch (e) {}
      return p;
    };
    function holdThen(go) {
      var done = false;
      var fire = function () { if (!done) { done = true; go(); } };
      sync().then(fire, fire);
      setTimeout(fire, 2500);
    }
    document.addEventListener('submit', function (e) {
      var f = e.target, s = e.submitter;
      if (!f || f.__atpBuyerDone) return;
      var toCheckout = (s && s.name === 'checkout') || /\\/checkout(\\?|$)/.test(f.getAttribute('action') || '');
      if (!toCheckout) return;
      e.preventDefault();
      f.__atpBuyerDone = true;
      holdThen(function () { if (f.requestSubmit) { f.requestSubmit(s || undefined); } else { f.submit(); } });
    }, true);
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank') return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.hostname !== location.hostname || !/^\\/(cart\\/)?checkout\\/?$/.test(url.pathname)) return;
      e.preventDefault();
      holdThen(function () { location.href = url.href; });
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { sync(); });
    else sync();
  } catch (e) {}
})();
true;`;
}
