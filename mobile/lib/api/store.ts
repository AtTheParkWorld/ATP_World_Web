/**
 * Store API. The product catalogue lives on Shopify (atthepark.world's
 * Shopify Storefront), accessed by members via shop.atthepark.world.
 * Mobile opens that in an in-app browser for browsing + checkout.
 *
 * What we DO talk to from mobile:
 *   - wishlist  (add / remove / list)
 *   - cart      (server-side persistent draft; the actual checkout
 *                still hits Shopify hosted checkout)
 *   - points-redemption history (the ATP→discount-code bridge)
 */
import { api } from './client';

export interface WishlistItem {
  product_id: string;       // Shopify product handle / GID
  product_title: string | null;
  product_image_url: string | null;
  added_at: string;
  product_handle?: string | null;
  product_price?: number | string | null;
  product_currency?: string | null;
}

/** Server responds { wishlist: rows } — NOT { items }. Normalize here so
 *  the screens' `r.items` keeps working (it was silently [] before). */
export async function getWishlist(): Promise<{ items: WishlistItem[] }> {
  const r = await api.get<{ wishlist?: WishlistItem[] }>('/store/wishlist');
  return { items: r.wishlist || [] };
}

export function addToWishlist(product: {
  product_id: string;
  product_title?: string;
  product_image_url?: string;
}): Promise<{ message?: string }> {
  return api.post('/store/wishlist', product);
}

export function removeFromWishlist(productId: string): Promise<{ message?: string }> {
  return api.delete(`/store/wishlist/${encodeURIComponent(productId)}`);
}

export interface PointsRedemptionHistoryRow {
  id: string;
  discount_code: string;
  /** Mapped client-side from the server's `points_spent` column. */
  points_redeemed: number;
  /** Mapped client-side from `amount_value` NUMERIC(10,2) — pg sends it
   *  as a string, and the old phantom `aed_value` crashed the Store tab
   *  (`undefined.toFixed`). Always a real number here. */
  aed_value: number;
  currency_code?: string | null;
  status: 'issued' | 'used' | 'expired' | 'refunded' | 'shopify_failed' | string;
  issued_at: string;
  used_at: string | null;
  expires_at: string | null;
}

/** Row exactly as /store/points/redemptions sends it. */
interface PointsRedemptionWireRow {
  id: string;
  points_spent: number;
  discount_code: string;
  amount_value: number | string | null;
  currency_code: string | null;
  status: string;
  issued_at: string;
  used_at: string | null;
  expires_at: string | null;
}

export async function getRedemptionHistory(): Promise<{ redemptions: PointsRedemptionHistoryRow[] }> {
  const r = await api.get<{ redemptions?: PointsRedemptionWireRow[] }>('/store/points/redemptions');
  return {
    redemptions: (r.redemptions || []).map((row) => ({
      id:              row.id,
      discount_code:   row.discount_code,
      points_redeemed: Number(row.points_spent) || 0,
      aed_value:       Number(row.amount_value) || 0,
      currency_code:   row.currency_code ?? null,
      status:          row.status,
      issued_at:       row.issued_at,
      used_at:         row.used_at,
      expires_at:      row.expires_at,
    })),
  };
}

// ── Order history (founder items 7 + 8) ─────────────────────────
// GET /store/orders — the member's own Shopify orders, matched
// server-side on their VERIFIED email. Always 200; when the list is
// empty `reason` says why so the screen can show the right next step.

export type OrderStatus =
  | 'processing' | 'pending_payment' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';

export interface OrderItem {
  title: string;
  variant: string | null;
  quantity: number;
  image_url: string | null;
  total: number | null;
}

export interface OrderTracking {
  number: string | null;
  company: string | null;
  url: string | null;
}

export interface ShopOrder {
  id: string;
  number: string;            // "#1004"
  created_at: string;
  cancelled_at: string | null;
  status: OrderStatus | string;
  status_label: string;
  currency: string | null;
  subtotal: number | null;
  shipping: number | null;
  total: number | null;
  items: OrderItem[];
  tracking: OrderTracking[];
  /** Carrier tracking page, else Shopify's order-status page. */
  track_url: string | null;
  order_status_url: string | null;
}

export type OrdersReason = null | 'no_email' | 'email_unverified' | 'not_configured' | 'shopify_unavailable';

export interface MyOrdersResponse {
  orders: ShopOrder[];
  reason: OrdersReason;
  account_orders_url: string;
}

export async function getMyOrders(opts: { fresh?: boolean } = {}): Promise<MyOrdersResponse> {
  const r = await api.get<Partial<MyOrdersResponse>>(`/store/orders${opts.fresh ? '?fresh=1' : ''}`);
  return {
    orders: r.orders || [],
    reason: (r.reason ?? null) as OrdersReason,
    account_orders_url: r.account_orders_url || 'https://atp-store-7903.myshopify.com/account',
  };
}

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '';
  const n = Number(amount);
  return `${currency || 'AED'} ${Number.isInteger(n) ? n : n.toFixed(2)}`;
}
