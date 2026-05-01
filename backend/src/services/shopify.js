/**
 * Shopify Admin API wrapper.
 *
 * Server-only — uses SHOPIFY_ADMIN_TOKEN, which must NEVER be exposed
 * to the browser. The Storefront API used by store.html is a separate
 * public token; this file is exclusively for write operations that
 * require elevated scopes (price-rule + discount creation).
 *
 * Required env:
 *   SHOPIFY_DOMAIN        e.g. atp-store-7903.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN   "shpat_..." from Shopify Admin → Apps →
 *                         Develop apps → ATP backend → API credentials
 *                         Required scopes:  write_discounts, read_discounts
 *
 * If either env var is missing, isConfigured() returns false and the
 * caller can fall back to issuing a code without Shopify (the legacy
 * behaviour from before this push).
 */

const ADMIN_API_VERSION = '2025-01';

function isConfigured() {
  return Boolean(process.env.SHOPIFY_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN);
}

async function _adminGraphQL(query, variables) {
  if (!isConfigured()) {
    const e = new Error('Shopify Admin API not configured (set SHOPIFY_DOMAIN + SHOPIFY_ADMIN_TOKEN)');
    e.code = 'SHOPIFY_NOT_CONFIGURED';
    throw e;
  }
  const url = 'https://' + process.env.SHOPIFY_DOMAIN +
              '/admin/api/' + ADMIN_API_VERSION + '/graphql.json';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error('Shopify Admin HTTP ' + res.status + ': ' + body.slice(0, 200));
    e.code = 'SHOPIFY_HTTP_' + res.status;
    throw e;
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const e = new Error('Shopify GraphQL: ' + json.errors.map((x) => x.message).join('; '));
    e.code = 'SHOPIFY_GRAPHQL';
    throw e;
  }
  return json.data;
}

/**
 * Create a single-use Shopify discount code worth a fixed amount off
 * the cart subtotal.
 *
 *   await createDiscountCode({
 *     code: 'ATP-PTS-A7K2M9',
 *     amount: 10,
 *     currency: 'AED',
 *     expiresAt: new Date('2026-06-01'),
 *     title: 'ATP points redemption',
 *   })
 *
 * Returns { id, code } where id is the Shopify discountCodeNode id
 * (gid://shopify/DiscountCodeNode/123…). Persist that id locally so
 * future admin actions (deactivate / refund) can target the same code.
 *
 * If the discount call fails, throws an Error with a `code` property
 * the caller can branch on — most commonly SHOPIFY_HTTP_401 (bad token)
 * or SHOPIFY_NOT_CONFIGURED (env vars missing).
 */
async function createDiscountCode({ code, amount, currency, expiresAt, title }) {
  if (!code) throw new Error('createDiscountCode: code required');
  if (!amount || amount <= 0) throw new Error('createDiscountCode: amount must be > 0');

  const startsAt = new Date().toISOString();
  const endsAt = expiresAt ? new Date(expiresAt).toISOString() : null;

  // discountCodeBasicCreate is the "fixed amount off / percentage off
  // the order or specific items" code type. We use:
  //   - usageLimit: 1   → single-use globally (anyone with the code,
  //                       once total). Prevents leaks via screenshot.
  //   - appliesOncePerCustomer: true   → defence in depth
  //   - customerSelection: { all: true } → any customer can use the
  //                       code (we don't have shopify customer ids
  //                       linked to ATP members yet; usageLimit:1
  //                       still enforces single-use)
  //   - minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal:
  //                       { amount, currencyCode } } } would force a
  //                       cart minimum — skipped for now since the
  //                       discount IS the user's earned points, not a
  //                       promo.
  const query = `
    mutation atpCreateDiscount($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) { nodes { code } }
              startsAt
              endsAt
            }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const input = {
    title: title || ('ATP points redemption — ' + code),
    code,
    startsAt,
    endsAt,
    usageLimit: 1,
    appliesOncePerCustomer: true,
    customerSelection: { all: true },
    customerGets: {
      value: {
        discountAmount: {
          amount: String(Number(amount).toFixed(2)),
          appliesOnEachItem: false,  // applies to the order subtotal once
        },
      },
      items: { all: true },
    },
  };

  const data = await _adminGraphQL(query, { input });
  const result = data && data.discountCodeBasicCreate;
  if (!result) throw new Error('Shopify: empty discountCodeBasicCreate response');
  if (result.userErrors && result.userErrors.length) {
    const msgs = result.userErrors.map((u) => u.field + ': ' + u.message).join('; ');
    const e = new Error('Shopify rejected discount: ' + msgs);
    e.code = 'SHOPIFY_USER_ERROR';
    e.userErrors = result.userErrors;
    throw e;
  }
  const node = result.codeDiscountNode;
  if (!node || !node.id) throw new Error('Shopify: no codeDiscountNode in response');
  return {
    id:   node.id,
    code: (node.codeDiscount && node.codeDiscount.codes && node.codeDiscount.codes.nodes[0] && node.codeDiscount.codes.nodes[0].code) || code,
  };
}

/**
 * Deactivate a previously-created code (e.g. when an admin needs to
 * void a redemption). Sets endsAt to "now" so it expires immediately.
 * The code is preserved for audit but rejected at checkout.
 */
async function deactivateDiscountCode(discountCodeNodeId) {
  if (!discountCodeNodeId) throw new Error('deactivateDiscountCode: id required');
  const query = `
    mutation atpDeactivate($id: ID!, $input: DiscountCodeBasicInput!) {
      discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `;
  const input = { endsAt: new Date().toISOString() };
  const data = await _adminGraphQL(query, { id: discountCodeNodeId, input });
  return data && data.discountCodeBasicUpdate;
}

module.exports = {
  isConfigured,
  createDiscountCode,
  deactivateDiscountCode,
};
