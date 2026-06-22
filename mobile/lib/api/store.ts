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
}

export function getWishlist(): Promise<{ items: WishlistItem[] }> {
  return api.get('/store/wishlist');
}

export function addToWishlist(product: {
  product_id: string;
  product_title?: string;
  product_image_url?: string;
}): Promise<{ ok: boolean }> {
  return api.post('/store/wishlist', product);
}

export function removeFromWishlist(productId: string): Promise<{ ok: boolean }> {
  return api.delete(`/store/wishlist/${encodeURIComponent(productId)}`);
}

export interface PointsRedemptionHistoryRow {
  id: string;
  discount_code: string;
  points_redeemed: number;
  aed_value: number;
  status: 'issued' | 'used' | 'expired' | 'shopify_failed' | string;
  issued_at: string;
  used_at: string | null;
  expires_at: string | null;
}

export function getRedemptionHistory(): Promise<{ redemptions: PointsRedemptionHistoryRow[] }> {
  return api.get('/store/points/redemptions');
}
