/**
 * App-open sequence (founder 2026-09-18).
 *
 * The opening promo and the new-notification spotlight must not fight
 * each other for the screen. The promo goes first; the spotlight waits
 * for it to finish — whether that means the member closed it, or there
 * was no promo to show at all.
 *
 * Module-level, so it resets naturally on a cold start and a member who
 * backgrounds the app mid-session isn't shown the sequence again.
 */
let promoSettled = false;
const waiters: Array<() => void> = [];

/** Called by PromoBannerModal when the promo closes, or when it decides
 *  there is nothing to show. Safe to call more than once. */
export function markPromoSettled(): void {
  if (promoSettled) return;
  promoSettled = true;
  while (waiters.length) waiters.shift()?.();
}

/** Resolves once the opening promo is out of the way. Includes a
 *  fallback timer: if the promo fetch hangs or errors in a way we don't
 *  catch, the spotlight still gets its turn rather than never showing. */
export function whenPromoSettled(timeoutMs = 9000): Promise<void> {
  if (promoSettled) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    waiters.push(finish);
    setTimeout(finish, timeoutMs);
  });
}
